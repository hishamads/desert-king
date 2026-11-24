/* =====================================================================
 * lang.js — app language (UI) and voice language, set separately.
 * ---------------------------------------------------------------------
 * The app is written in Arabic. English is applied at run time:
 *   • EN       — exact Arabic text → English (static screens, labels, toasts)
 *   • PREFIX   — Arabic prefix → English prefix (dynamic strings such as
 *                «تم نسخ الإحداثيات: …»; the rest of the text is kept)
 *   • A MutationObserver translates every text node / placeholder / title
 *     that the app creates, so no screen needs to know about languages.
 * Text that is not in the tables stays Arabic (user names, OSM names…).
 * Dynamic navigation text is produced bilingually by X(ar, en) / Voice.
 * Load order: lang.js → app.js (uses S.settings at call time only).
 * ===================================================================== */

const EN = {
  /* ---- main screen ---- */
  'ملاحة ملك الصحراء': 'Desert King Navigation', 'ملاحة': 'Navigation', 'ملك الصحراء': 'Desert King',
  'الخريطة': 'Map', 'رادار الإحداثيات': 'Coordinate radar', 'إلى أين؟': 'Where to?', 'حالة GPS': 'GPS status',
  'خروج': 'Exit', '📍 حفظ الموقع': '📍 Save place', '↩ العودة على الأثر': '↩ Backtrack', '⬇ حفظ المنطقة': '⬇ Save area',
  'بدون إنترنت': 'Offline', 'رادار': 'Radar', 'طبقات الخريطة': 'Map layers',
  'البوصلة: الشمال أو اتجاه الحركة للأعلى': 'Compass: north-up or heading-up',
  'بيانات GPS': 'GPS data', 'كم/س': 'km/h', 'الاتجاه': 'Heading', 'الارتفاع': 'Altitude', 'م': 'm', 'الدقة': 'Accuracy',
  'تسجيل المسار': 'Record track', 'تسجيل': 'Record', 'موقعي': 'My location', 'الاتجاهات': 'Directions',
  'إنهاء الملاحة': 'End navigation', 'استكشاف': 'Explore', 'محفوظاتي': 'Saved', 'الإعدادات': 'Settings',
  'رادار — بدون خرائط': 'Radar — no maps', '0 م': '0 m',
  /* ---- layers ---- */
  'نوع الخريطة': 'Map type', 'قمر صناعي': 'Satellite', 'تضاريس': 'Terrain', 'شوارع': 'Streets', 'رسومية': 'Vector',
  'قمر': 'Sat', 'إذا لم تتوفر صورة القمر الصناعي تظهر التضاريس المحفوظة مكانها تلقائياً. الرادار يعمل دائماً بدون خرائط.':
    'If satellite imagery is missing, the saved terrain is shown instead. The radar always works without maps.',
  '🧭 اتجاه الحركة للأعلى (الخريطة والرادار)': '🧭 Heading-up (map and radar)', 'دليل الخطوط': 'Line legend',
  'دليل الخطوط ▸': 'Line legend ▸', 'دليل الخطوط ▾': 'Line legend ▾',
  'طريق معبّد (مخطط)': 'Paved road (planned)', 'غير معبّد — مسار محفوظ': 'Unpaved — saved track', 'غير معبّد — اتجاه مباشر': 'Unpaved — direct line',
  'تسجيل جديد': 'New recording', 'مسار مسجّل سابقاً': 'Previously recorded track', 'مسار مستورد': 'Imported track',
  /* ---- place card ---- */
  'معلومات المكان': 'Place info', '🚗 الاتجاهات': '🚗 Directions', '🧭 مباشر': '🧭 Direct', '📍 حفظ كنقطة': '📍 Save as place',
  'نسخ الإحداثيات': 'Copy coordinates', 'نقطة محددة': 'Selected point', 'دبوس من الخريطة': 'Pin from the map',
  /* ---- recording ---- */
  'التسجيل': 'Recording', 'الوقت': 'Time', 'المسافة': 'Distance', 'النقاط': 'Points', '⏸ إيقاف مؤقت': '⏸ Pause', '▶ استئناف': '▶ Resume',
  'إيقاف مؤقت': 'Pause', 'استئناف': 'Resume', '■ إنهاء وحفظ المسار': '■ Finish & save track', '↩ العودة على الأثر (هذا التسجيل)': '↩ Backtrack (this recording)',
  /* ---- save place / track ---- */
  'حفظ نقطة': 'Save place', 'حفظ نقطة طريق': 'Save waypoint', 'الاسم': 'Name', 'التصنيف': 'Category', 'خط العرض': 'Latitude', 'خط الطول': 'Longitude',
  'الإحداثيات من موقعك الحالي — يمكنك تعديلها يدوياً.': 'Coordinates are from your current location — you can edit them.',
  'حفظ النقطة': 'Save place', 'إلغاء': 'Cancel', 'حفظ المسار': 'Save track', '〰 حفظ المسار المسجّل': '〰 Save recorded track', 'اسم المسار': 'Track name',
  '📍 حفظ نهاية المسار كموقع أيضاً بنفس الاسم': '📍 Also save the end of the track as a place (same name)',
  'المسار = الخط المرسوم كاملاً. الموقع = نقطة الوصول فقط (تظهر في البحث، و«الاتجاهات» إليها تستخدم هذا المسار تلقائياً).':
    'Track = the whole drawn line. Place = the arrival point only (shown in search; «Directions» to it reuse this track automatically).',
  'حذف التسجيل': 'Delete recording', 'متابعة لاحقاً': 'Continue later',
  'مخيم': 'Camp', 'بئر': 'Well', 'غراز': 'Soft sand', 'نقطة التقاء': 'Meeting point', 'خطر': 'Danger', 'سيارة': 'Car', 'منزل': 'House', 'مزرعة': 'Farm', 'عامة': 'General',
  /* ---- saved lists ---- */
  'النقاط والمسارات': 'Places & tracks', 'المواقع والمسارات': 'Places & tracks', '📍 المواقع': '📍 Places', '〰 المسارات': '〰 Tracks', 'المناطق المحفوظة': 'Saved areas',
  '⛺ تحميل مواقع الكشتات': '⛺ Load camping sites', '⬆ استيراد GPX': '⬆ Import GPX', '⬇ تصدير الكل GPX': '⬇ Export all GPX', '⬇ تصدير الكل': '⬇ Export all',
  'موثّق ✓': 'Verified ✓', 'غير موثّق': 'Unverified', 'مستورد': 'Imported', 'إخفاء': 'Hide', 'إظهار': 'Show',
  'المنطقة الشرقية': 'Eastern Province', 'منطقة الرياض': 'Riyadh Region', 'نقاط مرجعية (ليست مواقع تخييم)': 'Reference points (not camping sites)', 'نقاطي': 'My places',
  'لا توجد نقاط محفوظة بعد.': 'No saved places yet.', 'لا توجد مسارات محفوظة.': 'No saved tracks.',
  /* ---- settings ---- */
  'الإعدادات والأدوات': 'Settings & tools', 'إبقاء الشاشة نشطة': 'Keep the screen on', 'التحويل التلقائي للرادار عند غياب الخرائط': 'Switch to radar automatically when maps are missing',
  '🧭 تفعيل / معايرة البوصلة': '🧭 Enable / calibrate compass', 'الخرائط بدون إنترنت': 'Offline maps', '⬇ حفظ المنطقة للعمل بدون إنترنت': '⬇ Save area for offline use',
  'جارٍ حساب المساحة…': 'Calculating size…', 'مسح كل الخرائط المحفوظة': 'Delete all saved maps',
  'إعدادات التسجيل (توفير البطارية وتصفية التشويش)': 'Recording settings (battery saving & noise filtering)',
  'أقل مسافة بين النقاط (م)': 'Minimum distance between points (m)', 'أقصى زمن بين النقاط (ثانية)': 'Maximum time between points (s)',
  'تجاهل القراءات الأسوأ دقة من (م)': 'Ignore readings less accurate than (m)', 'ملفات GPX': 'GPX files',
  '🔄 تحديث التطبيق الآن': '🔄 Update the app now', 'يجلب أحدث إصدار. نقاطك ومساراتك والخرائط المحمّلة تبقى كما هي.': 'Fetches the latest version. Your places, tracks and downloaded maps stay as they are.',
  '🔊 الصوت واللغة': '🔊 Voice & language', 'التوجيه الصوتي': 'Voice guidance', 'لغة الصوت': 'Voice language', 'مستوى الصوت': 'Volume', 'لغة التطبيق': 'App language',
  '🔈 تجربة الصوت': '🔈 Test voice', '🔊': '🔊',
  /* ---- search ---- */
  'البحث': 'Search', '🔎 إلى أين؟': '🔎 Where to?', 'اسم مدينة، قرية، وادي، محطة… أو إحداثيات': 'City, village, valley, station… or coordinates',
  '🧭 تخطيط مسار (من / إلى)': '🧭 Plan a route (from / to)', 'لا توجد نتائج': 'No results', 'جارٍ تجهيز فهرس البحث…': 'Preparing the search index…',
  'مدينة': 'City', '🏠 العنوان الوطني': '🏠 National Address', 'مفتاح خدمة العنوان الوطني (مجاني)': 'National Address API key (free)', 'للبحث بالرمز المختصر مثل EMMA4120. احصل على المفتاح من api.address.gov.sa (اشتراك مجاني).': 'For short-code search such as EMMA4120. Get a key at api.address.gov.sa (free subscription).', '✓ تم حفظ المفتاح': '✓ Key saved', 'من الإنترنت': 'From the internet', 'بلدة': 'Town', 'قرية': 'Village', 'هجرة': 'Hamlet', 'موقع': 'Place', 'حي': 'District', 'مسكن': 'Dwelling', 'منطقة': 'Area', 'دولة': 'Country',
  'محطة وقود': 'Fuel station', 'مسجد': 'Mosque', 'مستشفى': 'Hospital', 'مستوصف': 'Clinic', 'صيدلية': 'Pharmacy', 'مدرسة': 'School', 'جامعة': 'University', 'كلية': 'College',
  'شرطة': 'Police', 'مطعم': 'Restaurant', 'مقهى': 'Café', 'تموينات': 'Grocery', 'بقالة': 'Grocery', 'سوق': 'Market', 'فندق': 'Hotel', 'بنك': 'Bank', 'صراف': 'ATM', 'ورشة': 'Workshop',
  'حديقة': 'Park', 'جبل': 'Mountain', 'بركان': 'Volcano', 'تل': 'Hill', 'وادي': 'Valley', 'رمال': 'Sand', 'صحراء': 'Desert', 'كثبان': 'Dunes', 'شاطئ': 'Beach', 'ماء': 'Water',
  'بحيرة': 'Lake', 'خزان': 'Reservoir', 'عين': 'Spring', 'وادي / شعيب': 'Valley / wadi', 'شعيب': 'Wadi', 'قناة': 'Canal', 'سبخة': 'Salt flat', 'منطقة إدارية': 'Administrative area',
  'مكان': 'Place', 'شجيرات': 'Scrub', 'سكة حديد': 'Railway', 'عبّارة': 'Ferry', 'مجمع تجاري': 'Mall', 'بلدية': 'Municipality', 'بريد': 'Post office', 'مكتبة': 'Library',
  'ملعب': 'Stadium', 'صخور': 'Rocks', 'بحر': 'Sea', 'خليج': 'Gulf', 'مطار': 'Airport', 'محطة': 'Station', 'موقف': 'Stop', 'طريق سريع': 'Highway', 'طريق': 'Road', 'شارع': 'Street',
  'ممر': 'Path', 'منطقة عسكرية': 'Military area', 'محمية': 'Nature reserve', 'متنزه': 'National park', 'معلم': 'Landmark', 'متحف': 'Museum', 'موقع أثري': 'Archaeological site',
  'آثار': 'Ruins', 'مطل': 'Viewpoint', 'منطقة صناعية': 'Industrial area', 'سكني': 'Residential', 'مقبرة': 'Cemetery', 'إحداثيات': 'Coordinates',
  /* ---- route planner ---- */
  'تخطيط المسار': 'Route planner', '🧭 الوجهة والمسار': '🧭 Destination & route', 'من': 'From', 'إحداثيات البداية (أو رابط خرائط جوجل)': 'Start coordinates (or a Google Maps link)',
  'إلى': 'To', 'إحداثيات الوجهة (أو رابط خرائط جوجل)': 'Destination coordinates (or a Google Maps link)',
  'الجزء المعبّد يُحسب عبر الإنترنت ويُحفظ على الجهاز. إن كانت الوجهة نهاية مسار مسجّل (مثل المخيم) يُكمل التطبيق عليه في غير المعبّد.':
    'The paved part is calculated online and saved on the device. If the destination is the end of a recorded track (e.g. the camp), the app continues on that track off-road.',
  'احسب المسار': 'Calculate route', '▶ ابدأ الملاحة': '▶ Start navigation', '↺ آخر مسار محسوب (يعمل دون اتصال)': '↺ Last calculated route (works offline)',
  '📡 موقعي الحالي': '📡 My current location', '✛ مركز الشاشة': '✛ Screen center', '⌨ إحداثيات / رابط خرائط جوجل': '⌨ Coordinates / Google Maps link',
  'مركز الشاشة': 'Screen center', 'جارٍ حساب المسار…': 'Calculating the route…',
  /* ---- offline download ---- */
  'حفظ المنطقة': 'Save area', 'حفظ المنطقة الظاهرة': 'Save the visible area', 'سيتم تنزيل مربعات الخريطة للمنطقة الظاهرة على الشاشة الآن وتخزينها على الجهاز.':
    'Map tiles for the area currently on screen will be downloaded and stored on the device.',
  'من مستوى تكبير': 'From zoom level', 'إلى مستوى تكبير': 'To zoom level', '🗺️ الخريطة الرسومية للمملكة كاملة (≈255 م.ب)': '🗺️ Vector map of the whole Kingdom (≈255 MB)',
  '🗺️ الخريطة الرسومية محفوظة ✓ (تحديث)': '🗺️ Vector map saved ✓ (update)', 'حذف الخريطة الرسومية': 'Delete the vector map',
  '🛰️ المملكة كاملة — قمر صناعي (تكبير 5–11 · ≈350 م.ب)': '🛰️ Whole Kingdom — satellite (zoom 5–11 · ≈350 MB)',
  '🏜️ خلفية تضاريس المملكة كاملة (تكبير 5–9 · ≈35 م.ب)': '🏜️ Whole Kingdom terrain background (zoom 5–9 · ≈35 MB)',
  'تُنزَّل مرة واحدة، وتظهر خلف الخريطة في أي مكان لا تتوفر فيه صور محفوظة.': 'Downloaded once; shown behind the map wherever no saved imagery exists.',
  'ابدأ التنزيل': 'Start download', 'إيقاف': 'Stop', 'إغلاق': 'Close',
  /* ---- start screen ---- */
  'ملاحة وتسجيل مسارات تعمل بدون إنترنت': 'Navigation and track recording that work without internet', '📡 سيُطلب إذن الموقع (GPS)': '📡 Location (GPS) permission will be requested',
  '🧭 وإذن حساسات الحركة للبوصلة (آيفون)': '🧭 and motion-sensor permission for the compass (iPhone)', '🔆 وتفعيل إبقاء الشاشة نشطة': '🔆 and the keep-screen-on option will be enabled',
  'ابدأ الملاحة': 'Start',
  /* ---- navigation banner / card ---- */
  'بانتظار إشارة GPS…': 'Waiting for a GPS signal…', 'معبّد': 'Paved', 'غير معبّد · مسار محفوظ': 'Unpaved · saved track', 'غير معبّد · مباشر': 'Unpaved · direct',
  'السهم بالنسبة للشمال — تحرّك أو فعّل البوصلة': 'Arrow is relative to north — move or enable the compass',
  'شمال': 'North', 'شمال شرق': 'North-east', 'شرق': 'East', 'جنوب شرق': 'South-east', 'جنوب': 'South', 'جنوب غرب': 'South-west', 'غرب': 'West', 'شمال غرب': 'North-west',
  /* ---- toasts & messages ---- */
  '⚠️ مساحة التخزين ممتلئة': '⚠️ Storage is full', 'هذا الجهاز لا يدعم تحديد الموقع': 'This device does not support location',
  '⚠️ يجب فتح التطبيق عبر HTTPS ليعمل GPS': '⚠️ The app must be opened over HTTPS for GPS to work',
  'تعذّر تحديد الموقع — تأكد من رؤية السماء': 'Could not get your location — make sure you can see the sky',
  'لم يُمنح إذن البوصلة — سيُستخدم اتجاه GPS أثناء الحركة': 'Compass permission denied — GPS heading will be used while moving',
  '⏺ بدأ تسجيل المسار': '⏺ Track recording started', '⏸ تم الإيقاف المؤقت': '⏸ Paused', '▶ استؤنف التسجيل': '▶ Recording resumed',
  'المسار قصير جداً (أقل من نقطتين) — لم يُحفظ': 'Track too short (under 2 points) — not saved', '✅ تم حفظ المسار': '✅ Track saved', 'تم حذف التسجيل': 'Recording deleted',
  '↺ تمت استعادة تسجيل غير مكتمل — اضغط «استئناف» للمتابعة': '↺ An unfinished recording was restored — tap «Resume» to continue',
  'إحداثيات غير صحيحة': 'Invalid coordinates', 'المسار لا يحتوي نقاطاً كافية': 'The track does not have enough points',
  '🏜️ دخلت الطريق غير المعبّد — التسجيل يعمل': '🏜️ Entered the unpaved road — recording is on',
  '🏜️ بداية غير المعبّد — اضغط ● لتسجيل مسارك': '🏜️ Start of the unpaved part — tap ● to record your track',
  'لا توجد إشارة GPS بعد — اختر نقطة بداية أخرى': 'No GPS signal yet — choose another start point', 'إحداثيات البداية غير صحيحة': 'Invalid start coordinates', 'إحداثيات الوجهة غير صحيحة': 'Invalid destination coordinates',
  '✓ حُفظ المسار على الجهاز — يمكن بدء الملاحة لاحقاً دون اتصال.': '✓ Route saved on the device — navigation can be started later without internet.',
  '⚠️ تعذّر الاتصال بخدمة الطرق — الجزء المعبّد مرسوم كخط مباشر. أعد الحساب عند توفر الإنترنت.': '⚠️ Could not reach the routing service — the paved part is drawn as a straight line. Recalculate when online.',
  'الخريطة الرسومية غير محفوظة بعد — نزّلها من «حفظ المنطقة»': 'The vector map is not saved yet — download it from «Save area»',
  'الخريطة: رسومية (بدون إنترنت)': 'Map: vector (offline)', '🗺️ لا توجد صور محفوظة هنا — تم التحويل للخريطة الرسومية': '🗺️ No saved imagery here — switched to the vector map',
  '📡 لا توجد صور ولا تضاريس محفوظة لهذه المنطقة — تم التحويل لوضع الرادار': '📡 No saved imagery or terrain for this area — switched to radar',
  'التخزين غير متاح — افتح التطبيق عبر HTTPS': 'Storage unavailable — open the app over HTTPS',
  'المنطقة: المملكة كاملة — اضغط «ابدأ التنزيل»': 'Area: whole Kingdom — tap «Start download»',
  'المنطقة: المملكة كاملة (قمر صناعي) — يُفضّل واي فاي — اضغط «ابدأ التنزيل»': 'Area: whole Kingdom (satellite) — Wi-Fi recommended — tap «Start download»',
  'لا يوجد اتصال بالإنترنت': 'No internet connection', '⚠️ امتلأت مساحة التخزين': '⚠️ Storage is full', 'تم إيقاف التنزيل': 'Download stopped',
  '✅ تم حفظ المنطقة للعمل بدون إنترنت': '✅ Area saved for offline use', 'تم مسح الخرائط المحفوظة': 'Saved maps deleted', 'لا توجد بيانات للتصدير': 'Nothing to export',
  'ملف GPX غير صالح': 'Invalid GPX file', '⏳ جارٍ تحميل مواقع الكشتات…': '⏳ Loading camping sites…', 'تعذر تحميل المواقع — تأكد من الاتصال بالإنترنت أول مرة': 'Could not load the sites — make sure you are online the first time',
  '✔ مواقع الكشتات موجودة مسبقاً': '✔ Camping sites are already loaded', 'لا توجد مواقع جديدة': 'No new places', 'انقطع التنزيل': 'Download interrupted',
  'جارٍ تنزيل فهرس البحث…': 'Downloading the search index…', '✅ تم حفظ الخريطة الرسومية للمملكة كاملة': '✅ Vector map of the whole Kingdom saved',
  '✅ الخريطة الرسومية جاهزة — اخترها من زر الطبقات': '✅ Vector map ready — choose it from the layers button', 'تم حذف الخريطة الرسومية': 'Vector map deleted',
  'مكتبة الخرائط غير محمّلة بعد — افتح التطبيق مرة واحدة مع إنترنت': 'The map library is not loaded yet — open the app once with internet',
  'الموقع محفوظ مسبقاً': 'This place is already saved', 'لا توجد نقاط كافية في التسجيل بعد': 'Not enough points in the recording yet',
  '🧭 اتجاه الحركة للأعلى': '🧭 Heading-up', '🧭 الشمال للأعلى': '🧭 North-up',
  'اتجاه الحركة للأعلى — يبدأ الدوران عند توفر الاتجاه (تحرّك أو فعّل البوصلة)': 'Heading-up — rotation starts once a heading is available (move or enable the compass)',
  'لا يوجد مسار مسجّل للعودة عليه بعد': 'No recorded track to backtrack yet', '🧭 البوصلة مفعّلة — للمعايرة حرّك الجوال على شكل رقم 8': '🧭 Compass enabled — to calibrate, move the phone in a figure 8',
  'البوصلة غير متاحة على هذا الجهاز': 'The compass is not available on this device', '🌐 عاد الاتصال — تم الرجوع للخريطة': '🌐 Back online — returned to the map',
  'يلزم اتصال بالإنترنت للتحديث': 'Internet is required to update', '⏳ جارٍ التحديث…': '⏳ Updating…',
  '⬆ يوجد تحديث جديد — سيُطبَّق عند انتهاء التسجيل أو الملاحة': '⬆ A new version is available — it will apply when recording or navigation ends',
  '⚠️ الصفحة ليست عبر HTTPS — لن يعمل GPS ولا العمل دون اتصال.': '⚠️ The page is not on HTTPS — GPS and offline use will not work.',
  'لا يوجد صوت متاح على الجهاز للغة المختارة — من الآيفون: الإعدادات ← إمكانية الوصول ← المحتوى المنطوق ← الأصوات': 'No voice is installed for the chosen language — on iPhone: Settings → Accessibility → Spoken Content → Voices',
  '🔊 التوجيه الصوتي: تشغيل': '🔊 Voice guidance: on', '🔇 التوجيه الصوتي: إيقاف': '🔇 Voice guidance: off',
  'يوجد تسجيل مسار جارٍ.\nحفظه قبل الخروج؟': 'A track recording is in progress.\nSave it before exiting?',
  'سيُحذف التسجيل الحالي. متابعة الخروج؟': 'The current recording will be deleted. Exit anyway?',
  'الخروج وإعادة الشاشة لوضعها الأول؟\n(نقاطك ومساراتك تبقى محفوظة)': 'Exit and reset the screen?\n(Your places and tracks stay saved)',
  'حذف التسجيل الحالي نهائياً؟': 'Delete the current recording permanently?',
  'مسح كل مربعات الخرائط المحفوظة؟ (المسارات والنقاط لن تُحذف)': 'Delete all saved map tiles? (Tracks and places are kept)',
  'حذف الخريطة الرسومية من الجهاز؟': 'Delete the vector map from the device?',
  'يوجد تسجيل جارٍ (محفوظ تلقائياً). متابعة التحديث؟': 'A recording is in progress (autosaved). Continue with the update?'
};

/* Arabic prefix → English prefix (the rest of the text is kept as is). */
const PREFIX = [
  ['🧭 بدأ التوجيه إلى: ', '🧭 Navigation started to: '], ['🎯 وصلت إلى الهدف: ', '🎯 You have arrived at: '], ['الوصول إلى ', 'Arrive at '],
  ['تم نسخ الإحداثيات: ', 'Coordinates copied: '], ['الخريطة: ', 'Map: '], ['محفوظ · ', 'Saved · '], ['مسار محفوظ · ', 'Saved track · '], ['نهاية مسار محفوظ · ', 'End of saved track · '],
  ['نهاية المسار «', 'End of track «'], ['نهاية ', 'End of '], ['بداية: ', 'Start: '], ['بداية ', 'Start of '], ['تعذّر حساب المسار: ', 'Could not calculate the route: '],
  ['جارٍ تنزيل الجزء ', 'Downloading part '], ['✅ تمت إضافة ', '✅ Added '], ['✅ تم استيراد ', '✅ Imported '], ['✅ تم حفظ «', '✅ Saved «'],
  ['📍 تم حفظ نهاية المسار كموقع «', '📍 End of the track saved as place «'], ['⚠️ خارج المسار بـ ', '⚠️ Off route by '], ['الآن: ', 'Now: '],
  ['اتبع المسار — اتجه ', 'Follow the track — head '], ['اتجه ', 'Head '], ['بعد ', 'In '], ['المنطقة: ', 'Area: '], ['الإصدار ', 'Version '],
  ['المستخدم: ', 'Used: '], ['توقف التنزيل (', 'Download stopped ('], ['استعادة ', 'Restored '], ['✔ تمت استعادة ', '✔ Restored '], ['وقت ', 'Time ']
];
const SUFFIX = [[' م.ب', ' MB'], [' ميجابايت', ' MB'], [' مربع', ' tiles'], [' من ', ' of ']];

const LG = {
  ui: 'ar',
  _orig: new WeakMap(),     // text node / element → { text | attr: original Arabic }
  _obs: null,
  _busy: false,

  /** Translate one Arabic string to the current UI language. */
  tr(s) {
    if (this.ui !== 'en' || !s) return s;
    const k = s.trim();
    if (!k || !/[؀-ۿ]/.test(k)) return s;
    if (EN[k] !== undefined) return s.replace(k, EN[k]);
    for (const [a, e] of PREFIX) if (k.startsWith(a)) {
      const rest = k.slice(a.length);
      return s.replace(k, e + (EN[rest] !== undefined ? EN[rest] : rest));
    }
    return s;
  },

  /** Walk a subtree and translate text nodes and attributes. */
  _walk(root) {
    const attrs = ['placeholder', 'aria-label', 'title'];
    const doNode = n => {
      if (n.nodeType === 3) {
        const v = n.nodeValue;
        if (!v || !/[؀-ۿ]/.test(v)) return;
        const out = this.tr(v);
        if (out !== v) { this._orig.set(n, v); n.nodeValue = out; }
      } else if (n.nodeType === 1) {
        for (const a of attrs) {
          const v = n.getAttribute(a);
          if (v && /[؀-ۿ]/.test(v)) {
            const out = this.tr(v);
            if (out !== v) { n.setAttribute('data-ar-' + a, v); n.setAttribute(a, out); }
          }
        }
      }
    };
    doNode(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) continue;
      doNode(n);
    }
  },

  /** Restore the Arabic originals (when switching back to Arabic). */
  _restore(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (n.nodeType === 3) { const o = this._orig.get(n); if (o !== undefined) { n.nodeValue = o; this._orig.delete(n); } }
      else for (const a of ['placeholder', 'aria-label', 'title']) {
        const o = n.getAttribute('data-ar-' + a);
        if (o !== null) { n.setAttribute(a, o); n.removeAttribute('data-ar-' + a); }
      }
    }
  },

  /** Switch the app language ('ar' | 'en'). */
  setUI(lang) {
    lang = lang === 'en' ? 'en' : 'ar';
    const root = document.documentElement;
    if (this._obs) { this._obs.disconnect(); this._obs = null; }
    if (lang === 'ar' && this.ui === 'en') this._restore(document.body);
    this.ui = lang;
    root.lang = lang;
    root.dir = lang === 'en' ? 'ltr' : 'rtl';
    root.classList.toggle('lang-en', lang === 'en');
    document.title = lang === 'en' ? 'Desert King Navigation' : 'ملاحة ملك الصحراء';
    if (lang === 'en') {
      this._walk(document.body);
      this._obs = new MutationObserver(muts => {
        if (this._busy) return;
        this._busy = true;
        try {
          for (const m of muts) {
            if (m.type === 'characterData') this._walk(m.target);
            else if (m.type === 'attributes') this._walk(m.target);
            else m.addedNodes.forEach(n => this._walk(n));
          }
        } finally { this._busy = false; }
      });
      this._obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
    }
  }
};

/** Pick the Arabic or English text for the current UI language. */
const X = (ar, en) => (LG.ui === 'en' ? en : ar);

/* confirm() messages go through the same table. */
(() => {
  const c = window.confirm.bind(window);
  window.confirm = s => c(LG.tr(s));
})();
