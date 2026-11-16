/** Persian terms (`English|فارسی` per line) and node descriptions of the Vector / simulation / motion-vector nodes, merged into FA_TERMS. */
export const FA_9B_RAW = `
Export Motion Vector|خروجی بردار حرکت
Vector flipbook|فلیپ‌بوک بردار
Sheet columns|ستون‌های شیت
Sheet rows|ردیف‌های شیت
Sheet frames|فریم‌های شیت
Sheet FPS|FPS شیت
Engine convention|قرارداد موتور
Unreal|Unreal
Flip Y (custom)|وارونه‌سازی Y (سفارشی)
Signed float (no 0.5 bias)|اعشاری علامت‌دار (بدون بایاس ۰٫۵)
Dissolve / Burn Front|انحلال / جبهه سوختن
Ignite|اشتعال
Wind|باد
Front mask|ماسک جبهه
Burned mask|ماسک سوخته
Edge glow|درخشش لبه
Time to burn|زمان تا سوختن
Front speed|سرعت جبهه
Front|جبهه
Burn duration|مدت سوختن
Height influence|تأثیر ارتفاع
Noise influence|تأثیر نویز
Wind influence|تأثیر باد
Constant wind|باد ثابت
Ignition point|نقطه اشتعال
Ignition|اشتعال
Ignition radius|شعاع اشتعال
Front width|پهنای جبهه
Glow length|طول درخشش
Time range|بازه زمانی
Sub-steps|زیرگام‌ها
Diffusion / Heat|پخش / گرما
Sink|چاه
Conductivity|رسانایی
Initial|اولیه
Heat flux|شار گرما
Diffusion|پخش
Along direction|در امتداد جهت
Across direction|عمود بر جهت
Source gain|گین منبع
Sources|منابع
Sink rate|نرخ چاه
Initial scale|مقیاس اولیه
Flux scale|مقیاس شار
Flow Advection Simulation|شبیه‌سازی انتقال جریان
Inject|تزریق
Flow scale|مقیاس جریان
Vorticity|ورتیسیته
Inject gain|گین تزریق
Injection|تزریق
Max value|حداکثر مقدار
Subdivisions|زیربخش‌ها
Branch probability|احتمال شاخه
Branch angle|زاویه شاخه
Branch length|طول شاخه
Branch depth|عمق شاخه
Max branches|حداکثر شاخه‌ها
Main thickness|ضخامت اصلی
Tip width|پهنای نوک
Branch width|پهنای شاخه
Branch brightness|روشنایی شاخه
Edge softness|نرمی لبه
Flicker rate|نرخ سوسو
Flicker loop (variants)|حلقه سوسو (تنوع‌ها)
Reaction Diffusion|واکنش-پخش
Seed mask|ماسک بذر
Feed map|نقشه تغذیه
Kill map|نقشه حذف
Feed|تغذیه
Reaction|واکنش
Kill|حذف
Diffusion A|پخش A
Diffusion B|پخش B
Time step|گام زمانی
Map range|بازه نقشه
Seed pattern|الگوی بذر
Seeding|بذرپاشی
Center disk|دیسک مرکزی
Points grid|شبکه نقاط
Mask only|فقط ماسک
Seed density|چگالی بذر
Noise cell size|اندازه سلول نویز
Points per side|نقطه در هر ضلع
Seed radius|شعاع بذر
Keep seeding from mask|ادامه بذرپاشی از ماسک
Pattern low|حد پایین الگو
Pattern high|حد بالای الگو
Wave Simulation|شبیه‌سازی موج
Impulse|ضربه
Initial height|ارتفاع اولیه
Wave speed|سرعت موج
Damping|میرایی
Reflect|بازتاب
Absorb|جذب
Periodic|دوره‌ای
Absorber width|پهنای جاذب
Impulse gain|گین ضربه
Initial height scale|مقیاس ارتفاع اولیه
Sine|سینوسی
Pulse|پالس
Pulse length (frames)|طول پالس (فریم)
Height gain|گین ارتفاع
Centered (0 = 50%)|مرکزی (۰ = ۵۰٪)
Vector Adjust|تنظیم بردار
Normalized length|طول نرمال‌شده
Dead zone|ناحیه مرده
Minimum length|حداقل طول
Maximum length|حداکثر طول
Reference length|طول مرجع
Invert X|وارونه X
Invert Y|وارونه Y
Vector Advect|انتقال با بردار
Strength mask|ماسک شدت
Single step (displace)|تک‌گام (جابه‌جایی)
Multi-step integration|انتگرال‌گیری چندگامی
Looping flow map|فلومپ حلقه‌ای
Backward (semi-Lagrangian)|پسرو (نیمه‌لاگرانژی)
Forward (content flows against)|پیشرو (محتوا خلاف جهت می‌رود)
Method|روش
Integration|انتگرال‌گیری
RK4|RK4
Flow map|فلومپ
Phase scatter|پراکندگی فاز
Vector Blur / Smooth|محوکردن / هموارسازی بردار
Taps per side|نمونه در هر سو
Vector Combine|ترکیب بردار
Vector A|بردار A
Vector B|بردار B
Max magnitude|بیشینه اندازه
Min magnitude|کمینه اندازه
Gain A|گین A
Gain B|گین B
Vector Compose|ساخت بردار
Centered (50% = 0)|مرکزی (۵۰٪ = ۰)
Vector Decompose|تجزیه بردار
Vector From Gray|بردار از خاکستری
Gradient (uphill)|گرادیان (سربالایی)
Rotated gradient (contours)|گرادیان چرخیده (خطوط تراز)
Extra rotation|چرخش اضافه
Slope limit|حد شیب
Vector From Normal|بردار از نرمال
Slope (downhill)|شیب (سرازیری)
Tangent XY|مماس XY
LIC (Line Integral Convolution)|LIC (کانولوشن انتگرال خطی)
Steps per side|گام در هر سو
Triangle|مثلث
Hann|هان
Constant speed|سرعت ثابت
Noise density|چگالی نویز
Ripple frequency|بسامد موج‌ک
Vector Motion Blur|محوشدگی حرکتی بردار
Shutter offset|آفست شاتر
Motion Vector Encode / Decode|رمزگذاری / رمزگشایی بردار حرکت
Encoded|رمزگذاری‌شده
Decoded|رمزگشایی‌شده
Precision|دقت
Float|اعشاری
Motion Vector Generate|تولید بردار حرکت
Motion flipbook|فلیپ‌بوک حرکت
Fast (Horn-Schunck)|سریع (هورن-شانک)
Quality (robust, warping)|کیفیت (مقاوم، وارپ)
Pyramid levels|سطوح هرم
Iterations per level|تکرار در هر سطح
Window size|اندازه پنجره
Max displacement|حداکثر جابه‌جایی
Median filter|فیلتر میانه
Input pre-blur|پیش‌محو ورودی
Match channel|کانال تطبیق
RGB mean|میانگین RGB
Red|قرمز
Green|سبز
Blue|آبی
Forward / backward check|بررسی پیشرو / پسرو
Consistency|سازگاری
Occlusion threshold|آستانه انسداد
Loop wrap|بسته‌شدن حلقه
Tiling wrap|پیچش کاشی
Motion Vector Interpolate|درون‌یابی بردار حرکت
Target frame count|تعداد فریم هدف
Time stretch factor|ضریب کشش زمان
Stretch factor|ضریب کشش
Cross-fade fallback|بازگشت به کراس‌فید
Preview position|موقعیت پیش‌نمایش
Difference gain|گین تفاضل
Vector Noise|نویز بردار
Curl (divergence-free)|کرل (بدون واگرایی)
Plain vector noise|نویز بردار ساده
Vector Noise Warp|وارپ نویز بردار
Warp amount|مقدار وارپ
Add to vectors|افزودن به بردارها
Vector Divergence-Free Project|تصویر بدون واگرایی بردار
Solver|حل‌کننده
Vector Radial|بردار شعاعی
Source 1|منبع ۱
Source 2|منبع ۲
Source 3|منبع ۳
Source 4|منبع ۴
Vector Spline|بردار اسپلاین
Flow along|جریان در امتداد
Attract / repel|جذب / دفع
Shear (around)|برش (پیرامون)
Vector Stats|آمار بردار
Mean vector|بردار میانگین
Max length|حداکثر طول
Vector Streamlines|خطوط جریان بردار
Seeds|بذرها
Vector Transform|تبدیل بردار
Warp field|میدان وارپ
Vectors|بردارها
Mirror X|آینه X
Mirror Y|آینه Y
Swap X / Y|جابه‌جایی X / Y
Remap length|بازنگاشت طول
Curve input range|بازه ورودی منحنی
Length curve|منحنی طول
Domain|دامنه
Vector Uniform|بردار یکنواخت
Direction from|جهت از
Line (gizmo)|خط (گیزمو)
Vector Vortex|بردار گردابه
Vector Warp|وارپ بردار
Normalize vectors|نرمال‌سازی بردارها
Chromatic split|جداسازی رنگی
Vector Particles|ذرات برداری
Whole tile|کل کاشی
Disc|دیسک
Line|خط
Input points|نقاط ورودی
Seed from|بذر از
Start / centre|شروع / مرکز
End|پایان
Travel time|زمان حرکت
Speed variation|تنوع سرعت
Euler|اویلر
RK2|RK2
Step size|اندازه گام
Max steps per path|حداکثر گام در هر مسیر
Wrap (tileable)|پیچش (کاشی‌پذیر)
Kill outside|حذف بیرون
Clamp to edge|چسباندن به لبه
View center|مرکز نما
View width (world)|پهنای نما (دنیا)
Flow|جریان
Emission|گسیل
Look|ظاهر
Advection|انتقال
`;

/** Node descriptions (shown in the search popup, node library, gallery and help); English is the source text of the definition. */
export const FA_NODE_DESC: Record<string, string> = {
  'vector.uniform': 'میدان برداری ثابت: زاویه و شدت، یا با گیزموی خط. ماسک اختیاری شدت را در هر پیکسل ضرب می‌کند.',
  'vector.noise': 'نویز برداری کاشی‌پذیر. حالت کرل بدون واگرایی است (چرخان و تراکم‌ناپذیر)؛ حالت ساده X و Y مستقل دارد. تکامل را ۰ تا ۱ انیمیت کنید تا حلقهٔ بی‌درز بگیرید.',
  'vector.radial': 'چشمه و چاهِ برداری از چند نقطه با افت نرم و گیزموی دایره.',
  'vector.vortex': 'گردابه با هستهٔ مشخص و افت نرم؛ چند گردابه با گیزمو.',
  'vector.spline': 'جریان در امتداد و پیرامونِ یک اسپلاین با پهنا و افت؛ از پین و گیزموی اسپلاین استفاده می‌کند.',
  'vector.from_gray': 'گرادیان یک تصویر خاکستری، گرادیان چرخیده (جریان روی خطوط تراز) و حد شیب.',
  'vector.from_normal': 'بردار شیب یا مماس از نرمال‌مپ.',
  'vector.combine': 'ترکیب دو بردار: جمع، ضرب، ترکیب، بیشینه/کمینهٔ اندازه و ماسک.',
  'vector.transform': 'چرخش، مقیاس، آینه، بازنگاشت طول با منحنی و وارپ خود میدان با میدان دیگر.',
  'vector.adjust': 'نرمال‌سازی، محدودسازی، بازنگاشت و وارونه‌سازی بردارها.',
  'vector.blur': 'محو / هموارسازی میدان برداری (آگاه از کاشی).',
  'vector.project': 'تصویر هلمهولتز: میدان را بدون واگرایی می‌کند (حل‌کنندهٔ جاکوبی / چندشبکه).',
  'vector.noise_warp': 'وارپ میدان برداری با نویز.',
  'vector.compose': 'ساخت بردار از دو تصویر خاکستری X و Y.',
  'vector.decompose': 'تجزیهٔ بردار به دو تصویر خاکستری X و Y.',
  'vector.stats': 'اندازه‌گیری میدان برداری روی GPU بدون بازخوانی: بردار میانگین، حداکثر طول و طول نرمال‌شده.',
  'vector.advect': 'انتقال تصویر در میدان برداری: تک‌گام، انتگرال‌گیری چندگامی RK2/RK4، یا فلومپ حلقه‌ای با دو فاز و وزن مثلثی برای انیمیشن بی‌درز.',
  'vector.warp': 'جابه‌جایی UV با یک بردار و مقیاس.',
  'vector.motion_blur': 'محوشدگی حرکتی در امتداد بردار با طول و تعداد نمونه.',
  'vector.lic': 'کانولوشن انتگرال خطی: بافت رگه، مو و خطوط باد از میدان برداری، کاشی‌پذیر.',
  'vector.streamlines': 'ماسک خطوط جریان ردیابی‌شده با چگالی بذر، طول، پهنا و محوشدگی.',
  'vector.particles': 'مجموعهٔ ذرهٔ بذردار را در میدان برداری حرکت می‌دهد (اویلر / RK2 / RK4) و نقاط را برای 2D Render خروجی می‌دهد. قطعی، حلقه‌پذیر، با سقف سخت.',
  'vector.motion_generate': 'جریان نوری هرمی روی GPU بین فریم‌های فلیپ‌بوک (سریع یا کیفیت)، فیلتر میانه، بررسی پیشرو/پسرو (ماسک انسداد)، حلقه و کاشی.',
  'vector.motion_interpolate': 'درون‌یابی فریم با بردارهای حرکت: وارپ پیشرو و پسرو، وزن آگاه از انسداد و بازگشت به کراس‌فید؛ فلیپ‌بوک جدید.',
  'vector.motion_encode': 'بسته‌بندی بردار در بافت RG برای موتورها (Unreal / Unity / Godot، بایاس ۰٫۵ یا علامت‌دار، ۸/۱۶ بیت) و بازگشایی آن.',
  'export.motion_vector': 'فلیپ‌بوک بردار حرکت را به‌صورت PNG ۱۶ بیت یا EXR همراه فایل JSON (مقیاس، شبکه، تعداد فریم، قرارداد) ذخیره می‌کند.',
  'simulation.fluid2d': 'سیال دوبعدی: دود، آتش و انفجار با فشار چندشبکه، موانع، احتراق و خروجی بردار حرکت.',
  'simulation.reaction_diffusion': 'واکنش-پخش (گری-اسکات): الگوهای ارگانیک کاشی‌پذیر مثل لکه، راه‌راه، مرجان و هزارتو.',
  'simulation.wave': 'معادلهٔ موج دوبعدی: موج‌ک از منابع و ماسک، مانع، مرز بازتابی/جاذب/دوره‌ای؛ خروجی ارتفاع، سرعت و نرمال.',
  'simulation.diffusion': 'پخش / گرمای همسانگرد و ناهمسانگرد (با میدان جهت برداری)، افت، منبع و چاه؛ برای درخشش و سوختگی.',
  'simulation.lightning': 'صاعقهٔ شاخه‌دار با جابه‌جایی نقطهٔ میانی بازگشتی؛ خروجی اسپلاین با پهنای هر نقطه و ماسک. سوسوی حلقه‌پذیر.',
  'simulation.burn_front': 'جبهه سوختن / انحلال با سرعت مدولهٔ نویز و باد؛ خروجی جبهه، سوخته، درخشش لبه و نقشهٔ زمان.',
  'simulation.flow_advect_sim': 'انتقال و انباشت پیوستهٔ بافت در میدان برداری با تزریق و اتلاف؛ ردّ دود ارزان و حلقه‌پذیر.',
};
