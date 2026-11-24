"""Build vector/search.json — every named feature of the offline vector map.

Reads the PMTiles parts in ./vector, decodes every vector tile and keeps one
entry per (name, kind, ~1 km cell). Output (compact JSON):
  {"v":1, "kinds":[...], "d":[[name, name_en, lat, lon, kindIndex], ...]}
Run by .github/workflows/build-search.yml.
"""
import glob, gzip, json, math, os, sys
from multiprocessing import Pool
from pmtiles.reader import Reader, MmapSource, all_tiles
import mapbox_vector_tile

SKIP_LAYERS = {'buildings', 'boundaries', 'earth'}

def merc(z, x, y, px, py, ext):
    n = 2 ** z
    lon = (x + px / ext) / n * 360 - 180
    t = math.pi * (1 - 2 * (y + py / ext) / n)
    return math.degrees(math.atan(math.sinh(t))), lon

def rep_point(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'Point': return c
    if t == 'MultiPoint': return c[0]
    if t == 'LineString': return c[len(c) // 2]
    if t == 'MultiLineString': l = max(c, key=len); return l[len(l) // 2]
    if t == 'Polygon': r = c[0]
    elif t == 'MultiPolygon': r = max((p[0] for p in c), key=len)
    else: return None
    return [sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)]

def work(item):
    (z, x, y), data = item
    try:
        if data[:2] == b'\x1f\x8b': data = gzip.decompress(data)
        tile = mapbox_vector_tile.decode(data, default_options={'y_coord_down': True})
    except Exception:
        return []
    out = []
    for lname, layer in tile.items():
        if lname in SKIP_LAYERS: continue
        ext = layer.get('extent', 4096)
        for f in layer['features']:
            p = f['properties']
            name = p.get('name:ar') or p.get('name')
            if not name: continue
            pt = rep_point(f['geometry'])
            if not pt: continue
            lat, lon = merc(z, x, y, pt[0], pt[1], ext)
            en = p.get('name:en') or ''
            if en == name: en = ''
            out.append((str(name), str(en), round(lat, 5), round(lon, 5), f"{lname}:{p.get('kind', '')}", z))
    return out

def main():
    parts = sorted(glob.glob('vector/ksa.pmtiles.part*'))
    with open('/tmp/ksa.pmtiles', 'wb') as o:
        for p in parts: o.write(open(p, 'rb').read())
    f = open('/tmp/ksa.pmtiles', 'rb')
    reader = Reader(MmapSource(f))
    items = list(all_tiles(reader.get_bytes))
    print('tiles', len(items), flush=True)
    best = {}
    with Pool(os.cpu_count()) as pool:
        for i, res in enumerate(pool.imap_unordered(work, items, chunksize=256)):
            for name, en, lat, lon, kind, z in res:
                key = (name, kind, round(lat, 2), round(lon, 2))
                if key not in best or z > best[key][5]:     # keep most precise zoom
                    best[key] = (name, en, lat, lon, kind, z)
            if i % 50000 == 0: print(i, len(best), flush=True)
    # Merge long roads/valleys split across tiles: one entry per (name, kind, ~5 km)
    final = {}
    for (name, kind, _, _), v in best.items():
        k2 = (name, kind, round(v[2] / 0.05), round(v[3] / 0.05))
        if k2 not in final: final[k2] = v
    kinds = sorted({v[4] for v in final.values()})
    ki = {k: i for i, k in enumerate(kinds)}
    d = [[v[0], v[1], v[2], v[3], ki[v[4]]] for v in final.values()]
    d.sort(key=lambda r: r[0])
    json.dump({'v': 1, 'kinds': kinds, 'd': d}, open('vector/search.json', 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print('entries', len(d), 'kinds', len(kinds), 'bytes', os.path.getsize('vector/search.json'))
    from collections import Counter
    print(Counter(v[4] for v in final.values()).most_common(60))

if __name__ == '__main__':
    main()
