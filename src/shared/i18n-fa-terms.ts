/**
 * Persian term table for node UI text. Keyed by the ENGLISH text, one entry per distinct word / phrase, so a term such as
 * "Scale" or "Seed" is translated once for every node that uses it (titles, pin names, parameter labels, tabs, groups, enum options).
 * A specific key `node.<id>.param.<p>.label` (see i18n.ts `nodeKeys`) always wins over this table; a missing term falls back to English.
 * Format: one `English|فارسی` per line. File formats, shader code and identifiers (PNG, EXR, glTF, UV, HDR ...) stay Latin.
 * Suffix forms "X (Color)", "X (Points)" ... are handled by `trTerm` (i18n.ts) from the base term.
 */
import { FA_9B_RAW } from './i18n-fa-9b';
import { FA_SIM_RAW } from './i18n-fa-sim';

const RAW = `
Camera|دوربین
Look At|نگاه به
Adjust|تنظیم
Blackbody / Temperature Ramp|جسم سیاه / رمپ دما
Hue Spread|پراکندگی رنگ‌مایه
Interpolate|درون‌یابی
Premultiply Alpha|پیش‌ضرب آلفا
Ramp|رمپ
Replace Color|جایگزینی رنگ
Uniform Color|رنگ یکنواخت
Export Color|خروجی رنگ
Export Mask|خروجی ماسک
Export Mesh|خروجی مش
Export Multimask|خروجی چندماسک
Export Normal|خروجی نرمال‌مپ
Export Viewport|خروجی نما
Export Warp|خروجی وارپ
Accumulate|انباشت
Bake|بیک
Bounds|کران‌ها
Combine Color|ترکیب رنگ
Combine Scale|ترکیب مقیاس
Combine Transform|ترکیب تبدیل
Copy To Points|کپی روی نقاط
Copy and Transform|کپی و تبدیل
Delete By Mask|حذف با ماسک
Extract Points|استخراج نقاط
Merge Vertices|ادغام رئوس
Merge|ادغام
Noise|نویز
Normals|نرمال‌ها
Points Shape|شکل نقاط
Promote|ارتقا
Shapes|شکل‌ها
Space Warp|وارپ فضایی
Spline Combine|ترکیب اسپلاین
Spline Resample|بازنمونه‌گیری اسپلاین
Spline Shape|شکل اسپلاین
Spline Transform|تبدیل اسپلاین
Spline to Points|اسپلاین به نقاط
Subdivide|زیرتقسیم
Sweep|سوییپ
Transform|تبدیل
Triangulate|مثلث‌بندی
UV|UV
Ambient Occlusion|انسداد محیطی
Caustics|کاستیک
Curvature|انحنا
Curve|منحنی
Dilate|گسترش
Filter|فیلتر
Fractal|فراکتال
Gradient|گرادیان
Lightning|رعدوبرق
Polar Scatter|پخش قطبی
Ripple / Shockwave|موج / شوک‌ویو
Ripple|موج
Rune Ring|حلقهٔ رون
Shape|شکل
Slice|برش
Spline|اسپلاین
Starburst / Glint|انفجار ستاره‌ای / برق
Threshold|آستانه
Uniform|یکنواخت
Flipbook|فلیپ‌بوک
Model|مدل
Texture|تکسچر
Islands Generate|ساخت جزیره‌ها
Islands Padding|حاشیهٔ جزیره‌ها
Islands To Color|جزیره‌ها به رنگ
Islands To Gradient|جزیره‌ها به گرادیان
Islands To Grayscale|جزیره‌ها به خاکستری
Islands To UV|جزیره‌ها به UV
Color to Normal|رنگ به نرمال
Normal Combine|ترکیب نرمال
Normal Create|ساخت نرمال
Normal Merge|ادغام نرمال
Normal Split|تفکیک نرمال
Normal to Color|نرمال به رنگ
Emitter|امیتر
Point Attributes|ویژگی‌های نقطه
2D Render|رندر ۲بعدی
Input|ورودی
Output|خروجی
Alpha Merge|ادغام آلفا
Alpha Split|تفکیک آلفا
Auto Crop|برش خودکار
Bilateral Filter|فیلتر دوطرفه
Blend|ترکیب
Blur|محو
Cartesian to Polar|دکارتی به قطبی
Polar to Cartesian|قطبی به دکارتی
Chromatic Aberration|زیغ رنگی
Color to UV|رنگ به UV
Denoise|نویززدایی
Directional Blur|محو جهت‌دار
Dissolve Over Time|انحلال در طول زمان
Distance|فاصله
Edge Detect|تشخیص لبه
Fluid Advect|جابه‌جایی سیال
FXAA|FXAA
Glow|درخشش
Grid|شبکه
HSVA to RGBA|HSVA به RGBA
RGBA to HSVA|RGBA به HSVA
Kaleidoscope|کالیدوسکوپ
Anisotropic Kuwahara|کوواهارای ناهمسان
Lattice|شبکهٔ تغییر شکل
Levels|سطوح
Light Pack (Fake Lighting)|بستهٔ نور (نورپردازی کاذب)
Math|ریاضی
Multi Blend|ترکیب چندگانه
Multi Switch|سوییچ چندگانه
Radial Blur|محو شعاعی
RGB to Grayscale|RGB به خاکستری
RGBA Merge|ادغام RGBA
RGBA Split|تفکیک RGBA
Sheet Decode|رمزگشایی شیت
Sheet Encode|رمزگذاری شیت
Softblend|ترکیب نرم
Tile|تایل
UV Merge|ادغام UV
UV Split|تفکیک UV
UV to Color|UV به رنگ
UV Blend|ترکیب UV
UV Blur|محو UV
UV Directional|UV جهت‌دار
UV Flow|جریان UV
UV From Grayscale|UV از خاکستری
UV Identity|UV همانی
UV Noise|نویز UV
UV Radial|UV شعاعی
UV Rotational|UV چرخشی
UV Spline|اسپلاین UV
UV Transform|تبدیل UV
Mesh|مش
Points|نقاط
Gray|خاکستری
Normal|نرمال
Color|رنگ
Import|وارد کردن
Export|خروجی
Camera|دوربین
Look At|نگاه به
Splats|لکه‌ها
Channels|کانال‌ها
Fade|محوشدگی
Drift|رانش
Source|منبع
Write|نوشتن
Driver|درایور
Copy|کپی
Copies|کپی‌ها
Ranges|بازه‌ها
Mask|ماسک
Extract|استخراج
Attributes|ویژگی‌ها
Merge|ادغام
Animation|انیمیشن
Falloff|افت
Geometry|هندسه
Warp|وارپ
Space|فضا
Path|مسیر
Profile|پروفایل
Orientation|جهت‌گیری
Emission|گسیل
Motion|حرکت
Look|ظاهر
Life|عمر
Clipping|برش‌دهی
Tone|تُن
Tint|پرده رنگی
Temperature|دما
Alpha|آلفا
Preview|پیش‌نمایش
Main|اصلی
Z axis|محور Z
Atlas|اطلس
Octaves|اکتاو‌ها
Size|اندازه
Position|موقعیت
Visibility|دید
Splat color|رنگ لکه
Hue|رنگ‌مایه
Id|شناسه
Colors|رنگ‌ها
Mix|ترکیب
Replace|جایگزینی
Match|تطبیق
Result|نتیجه
Frames|فریم‌ها
Quality|کیفیت
Coordinates|مختصات
Pivot|محور چرخش
R channel|کانال R
G channel|کانال G
B channel|کانال B
A channel|کانال A
2D|۲بعدی
3D|۳بعدی
Step|گام
Jitter|لرزش تصادفی
Color (Cd)|رنگ (Cd)
Distribution|توزیع
Subdivision|زیرتقسیم
Corner offsets|آفست گوشه‌ها
Along length|در طول مسیر
Taper|باریک‌شوندگی
U (around)|U (دور پروفایل)
V (along)|V (در طول مسیر)
Projection|تصویر‌سازی
Island packing|بسته‌بندی جزیره‌ها
UV transform|تبدیل UV
Occlusion|انسداد
Pattern|الگو
Morphology|ریخت‌شناسی
Repeat|تکرار
Remap|بازنگاشت
Bolt|صاعقه
Branches|شاخه‌ها
Strike|ضربه
Cellular|سلولی
Layout|چیدمان
Angle|زاویه
Randomness|تصادفی‌سازی
Element|عنصر
Ring|حلقه
Rings|حلقه‌ها
Wobble|لرزش
Stroke|خط
Glyphs|گلیف‌ها
Variation|تنوع
Edge|لبه
Outline|دورخط
Band|باند
Multiple bands|باندهای چندگانه
Splines|اسپلاین‌ها
Burst|انفجار
Rays|پرتوها
Core|هسته
Edit|ویرایش
Gray output|خروجی خاکستری
Normal output|خروجی نرمال
UV output|خروجی UV
Limits|محدودیت‌ها
Padding|حاشیه
Convert|تبدیل
Combine|ترکیب
Split|تفکیک
Timing|زمان‌بندی
Velocity|سرعت
Forces|نیروها
Rotation|چرخش
Flow|جریان
Age|سن
View|نما
Sprite|اسپرایت
Motion stretch|کشیدگی حرکتی
Interface|رابط
Default|پیش‌فرض
Crop|برش
Aperture|دیافراگم
Tiling|تایلینگ
Overlap|هم‌پوشانی
Dispersion|پاشندگی
Decode|رمزگشایی
Direction|جهت
Dissolve|انحلال
Order|ترتیب
Edges|لبه‌ها
Lines|خطوط
Cells|سلول‌ها
Symmetry|تقارن
Brush|قلم‌مو
Control points|نقاط کنترل
Surface|سطح
Lights|نورها
Shading|سایه‌زنی
Layers|لایه‌ها
Layer 1|لایه ۱
Layer 2|لایه ۲
Layer 3|لایه ۳
Layer 4|لایه ۴
Layer 5|لایه ۵
Layer 6|لایه ۶
Layer 7|لایه ۷
Layer 8|لایه ۸
Switch|سوییچ
Conversion|تبدیل
Defaults|پیش‌فرض‌ها
Playback|پخش
Tiles|تایل‌ها
Offsets|آفست‌ها
Random per tile|تصادفی برای هر تایل
Encode|رمزگذاری
Time|زمان
Field|میدان
Radial|شعاعی
Swirl|چرخش گردابی
Width|عرض
Height|ارتفاع
Mesh 1|مش ۱
Mesh 2|مش ۲
Mesh 3|مش ۳
Mesh 4|مش ۴
Mesh 5|مش ۵
Mesh 6|مش ۶
Points 1|نقاط ۱
Points 2|نقاط ۲
Points 3|نقاط ۳
Points 4|نقاط ۴
Points 5|نقاط ۵
Points 6|نقاط ۶
Input 1|ورودی ۱
Input 2|ورودی ۲
Input 3|ورودی ۳
Input 4|ورودی ۴
Input 5|ورودی ۵
Input 6|ورودی ۶
Input 7|ورودی ۷
Input 8|ورودی ۸
Input Pattern|الگوی ورودی
R source|منبع R
G source|منبع G
B source|منبع B
A source|منبع A
Packed|بسته‌بندی‌شده
Sheet|شیت
Island Map|نقشهٔ جزیره
Centre|مرکز
Labels|برچسب‌ها
Base|پایه
Detail|جزئیات
Foreground|پیش‌زمینه
Background|پس‌زمینه
Scale map|نقشهٔ مقیاس
Heat|گرما
Point ID|شناسهٔ نقطه
Nearest UV|نزدیک‌ترین UV
Cell ID|شناسهٔ سلول
RGB Color|رنگ RGB
Grayscale|خاکستری
Foreground height|ارتفاع پیش‌زمینه
Background height|ارتفاع پس‌زمینه
Tile ID|شناسهٔ تایل
Weight A|وزن A
Target|هدف
Orthographic|ارتوگرافیک
Field of view|میدان دید
Ortho height|ارتفاع ارتوگرافیک
Roll|رول
Near|نزدیک
Far|دور
Saturation|اشباع
Value|مقدار
Brightness|روشنایی
Contrast|کنتراست
Gamma|گاما
Exposure|نوردهی
Tint amount|مقدار پرده رنگی
Intensity|شدت
Alpha mode|حالت آلفا
Seed|سید
Anisotropy|ناهمسانی
Z position|موقعیت Z
Z layers|لایه‌های Z
Sides|ضلع‌ها
Rounding|گردی
Inner filling|پرشدگی داخلی
Atlas size|اندازهٔ اطلس
Shape remap|بازنگاشت شکل
Splat blending|ترکیب لکه‌ها
Lacunarity|لاکوناریتی
Gain|بهره
Align to UVs|هم‌راستا با UV
Rotation min|حداقل چرخش
Rotation max|حداکثر چرخش
Flip horizontal|قرینهٔ افقی
Flip vertical|قرینهٔ عمودی
Scale min|حداقل مقیاس
Scale max|حداکثر مقیاس
Scale|مقیاس
Position randomization|تصادفی‌سازی موقعیت
Intensity min|حداقل شدت
Intensity max|حداکثر شدت
Color source|منبع رنگ
Hue min|حداقل رنگ‌مایه
Hue max|حداکثر رنگ‌مایه
Base color|رنگ پایه
Mode|حالت
Hue start|شروع رنگ‌مایه
Hue range|بازهٔ رنگ‌مایه
Quantize|کوانتیزه
Color A|رنگ A
Color B|رنگ B
Mix space|فضای ترکیب
Mask curve|منحنی ماسک
Amount|مقدار
Invert mask|وارونهٔ ماسک
Input low|ورودی پایین
Input high|ورودی بالا
Offset|آفست
Wrap|پیچش
Source color|رنگ مبدأ
New color|رنگ جدید
Tolerance|تلرانس
Softness|نرمی
Strength|قدرت
File name|نام فایل
Engine preset|پیش‌تنظیم موتور
Format|قالب
Bit depth|عمق بیت
Color space|فضای رنگ
Write alpha|نوشتن آلفا
Size mode|حالت اندازه
First frame|فریم اول
Frame count|تعداد فریم
Columns (0 = auto)|ستون‌ها (۰ = خودکار)
Rows (0 = auto)|سطرها (۰ = خودکار)
Row order|ترتیب سطرها
Write JSON metadata|نوشتن فراداده JSON
Texture format|قالب تکسچر
Pivot position|موقعیت محور
Invert|وارونه
Resolution (px)|وضوح (px)
Supersampling|سوپرسمپلینگ
Transparent background|پس‌زمینهٔ شفاف
Background colour|رنگ پس‌زمینه
Display|نمایش
Encoding|رمزگذاری
Vertical flip|قرینهٔ عمودی
Max count|حداکثر تعداد
Include current frame|شامل فریم فعلی
Attribute name|نام ویژگی
Write to|نوشتن در
UV set|مجموعهٔ UV
Bias|بایاس
Frames per second|فریم بر ثانیه
Attribute|ویژگی
Range min|حداقل بازه
Range max|حداکثر بازه
Noise type|نوع نویز
Frequency|فرکانس
Random seed|سید تصادفی
Color ramp|رمپ رنگ
Remap curve|منحنی بازنگاشت
Write R|نوشتن R
Write G|نوشتن G
Write B|نوشتن B
Write A|نوشتن A
Blend with existing|ترکیب با موجود
Opacity|شفافیت
Texture channel|کانال تکسچر
Move points|جابه‌جایی نقاط
Use orient|استفاده از جهت
Use pscale|استفاده از pscale
Translate|جابه‌جایی
Rotate|چرخش
Jitter translate|لرزش جابه‌جایی
Jitter rotate|لرزش چرخش
Jitter scale|لرزش مقیاس
Color start|رنگ شروع
Color end|رنگ پایان
Box center|مرکز جعبه
Box size|اندازهٔ جعبه
Remove unused points|حذف نقاط بی‌استفاده
Max points|حداکثر نقاط
Keep attributes|حفظ ویژگی‌ها
Axis|محور
Amplitude|دامنه
Animate (4th dimension)|انیمیشن (بُعد چهارم)
Loop with graph|حلقه با گراف
Cycles per loop|چرخه در هر حلقه
Mask source|منبع ماسک
Enable falloff region|فعال‌سازی ناحیهٔ افت
Center|مرکز
Inner radius|شعاع داخلی
Outer radius|شعاع بیرونی
Flip normals|وارونهٔ نرمال‌ها
Count|تعداد
Start|شروع
End|پایان
Radius|شعاع
Random orientation|جهت تصادفی
From|از
To|تا
Reduction|کاهش
Keep original|حفظ اصل
Turns|دور
Depth|عمق
Rim|لبه
Segments|بخش‌ها
Columns|ستون‌ها
Rows|سطرها
Planes|صفحه‌ها
Caps|درپوش‌ها
Length|طول
Preserve volume|حفظ حجم
Phase|فاز
Decay|زوال
Random jitter|لرزش تصادفی
Jitter seed|سید لرزش
Channel|کانال
Neutral value|مقدار خنثی
Iterations|تکرارها
Corner cut|برش گوشه
3D Spline|اسپلاین ۳بعدی
Closed loop|حلقهٔ بسته
Profile resolution|وضوح پروفایل
Star points|رأس‌های ستاره
Custom profile|پروفایل سفارشی
Cap start|درپوش ابتدا
Cap end|درپوش انتها
Scale along length|مقیاس در طول مسیر
Twist along length|پیچش در طول مسیر
Taper start|باریکی ابتدا
Taper end|باریکی انتها
Up vector|بردار بالا
U tiling|تایلینگ U
V tiling|تایلینگ V
Uniform scale|مقیاس یکنواخت
Margin|حاشیه
Directions|جهت‌ها
Steps|گام‌ها
Evolution|تکامل
Speed|سرعت
Distortion|اعوجاج
Focus|تمرکز
Sharpness|تیزی
Black point|نقطهٔ سیاه
Type|نوع
Operation|عملیات
Median size|اندازهٔ میانه
Glow radius|شعاع درخشش
Roughness|زبری
Reveal|آشکارسازی
Distance metric|معیار فاصله
Edge width|عرض لبه
Domain warp|وارپ دامنه
Ring count|تعداد حلقه
Start angle|زاویهٔ شروع
Angle range|بازهٔ زاویه
Angle jitter|لرزش زاویه
Radius jitter|لرزش شعاع
Thickness|ضخامت
Stretch|کشیدگی
Spacing|فاصله‌گذاری
Lobes|لوب‌ها
Glyph size|اندازهٔ گلیف
Gap|شکاف
Flicker|سوسو
Bevel|پخ
Outline width|عرض دورخط
Bands|باندها
Width profile|پروفایل عرض
Cross section|مقطع
Ray length|طول پرتو
Ray width|عرض پرتو
Twinkle|چشمک
Core size|اندازهٔ هسته
Core glow|درخشش هسته
Halo radius|شعاع هاله
Halo|هاله
Smoothness|نرمی
Low level|سطح پایین
High level|سطح بالا
Hard threshold|آستانهٔ سخت
Image|تصویر
Up axis|محور بالا
Output size|اندازهٔ خروجی
Frame count|تعداد فریم
Playback fps|fps پخش
Connectivity|اتصال
Max islands|حداکثر جزیره
Random angle|زاویهٔ تصادفی
Keep aspect|حفظ نسبت
Output range|بازهٔ خروجی
Fit|برازش
Normalize|نرمال‌سازی
Blend mode|حالت ترکیب
Detail strength|قدرت جزئیات
Kernel|هسته
Invert height|وارونهٔ ارتفاع
Range|بازه
Lifetime|طول عمر
Spawn window|پنجرهٔ تولید
Plane|صفحه
Cone|مخروط
Gravity|گرانش
Drag|مقاومت
Turbulence|تلاطم
Color over life|رنگ در طول عمر
Alpha over life|آلفا در طول عمر
Size over life|اندازه در طول عمر
Soft edge|لبهٔ نرم
Draw order|ترتیب رسم
Max particles|حداکثر ذره
Default color|رنگ پیش‌فرض
Default value|مقدار پیش‌فرض
Premultiply|پیش‌ضرب
Unpremultiply|حذف پیش‌ضرب
Spiral|مارپیچ
Pinch|فشردگی
Perspective|پرسپکتیو
Samples|نمونه‌ها
Search radius|شعاع جستجو
Adaptive|تطبیقی
Placement|جایگذاری
Progress|پیشرفت
Reverse|معکوس
Signed|علامت‌دار
Max distance|حداکثر فاصله
Divergence|واگرایی
Knee|زانو
Line width|عرض خط
Mirror|آینه
Zoom|بزرگ‌نمایی
Shift|جابه‌جایی
Smoothing|هموارسازی
Auto levels|سطوح خودکار
Output low|خروجی پایین
Output high|خروجی بالا
Clamp output|محدود کردن خروجی
Include alpha|شامل آلفا
Elevation|ارتفاع زاویه‌ای
Ambient|محیطی
Enabled|فعال
Index|اندیس
Inputs|ورودی‌ها
Weights|وزن‌ها
Normalize weights|نرمال‌سازی وزن‌ها
Multiply by alpha|ضرب در آلفا
Frame|فریم
Loop mode|حالت حلقه
Blend frames|ترکیب فریم‌ها
Start frame|فریم شروع
End frame|فریم پایان
Automatic grid|شبکهٔ خودکار
Row offset|آفست سطر
Column offset|آفست ستون
Random flip|قرینهٔ تصادفی
Skew|اریب
Reference|مرجع
Cycles|چرخه‌ها
Phase offset|آفست فاز
Reverse direction|جهت معکوس
Add|جمع
Subtract|تفریق
Multiply|ضرب
Divide|تقسیم
Screen|اسکرین
Overlay|اورلی
Difference|تفاضل
Exclusion|حذف
Soft Light|نور نرم
Hard Light|نور سخت
Min|حداقل
Max|حداکثر
Off|خاموش
None|هیچ
Clamp|محدود
Linear|خطی
Smooth|نرم
Flat|تخت
Hard|سخت
Soft|نرم
Random|تصادفی
Line|خط
Circle|دایره
Sphere|کره
Cube|مکعب
Cylinder|استوانه
Torus|چنبره
Disc|دیسک
Quad|چهارضلعی
Star|ستاره
Polygon|چندضلعی
Arc|کمان
Ribbon|روبان
Custom|سفارشی
Ellipse|بیضی
Heart|قلب
Cross|ضربدر
Crescent|هلال
Lightning bolt|صاعقه
Rounded rect|مستطیل گرد
Rounded rectangle|مستطیل گرد
Box|جعبه
Island|جزیره
Convex|محدب
Concave|مقعر
Sharpen|تیز کردن
Emboss|برجسته‌سازی
Median|میانه
Box blur|محوی جعبه‌ای
Gaussian blur|محوی گاوسی
Gaussian|گاوسی
Perlin|پرلین
Simplex|سیمپلکس
Cubic|مکعبی
Billow|موج‌دار
Ridged|برجسته
Cracks|ترک‌ها
Euclidean|اقلیدسی
Manhattan|منهتن
Chebyshev|چبیشف
Constant|ثابت
Fill|پر کردن
Inner outline|دورخط داخلی
Outer outline|دورخط بیرونی
Top to bottom|بالا به پایین
Bottom to top|پایین به بالا
Top down|بالا به پایین
Bottom up|پایین به بالا
Keep|حفظ
Original|اصل
Native|بومی
Manual|دستی
Manual grid|شبکهٔ دستی
Detect grid|تشخیص شبکه
Not a flipbook|فلیپ‌بوک نیست
Random HSV|HSV تصادفی
Gradient by ID|گرادیان بر اساس شناسه
Luminance|درخشندگی
Zero|صفر
One|یک
Vertex|رأس
Point|نقطه
Vertices|رئوس
Average|میانگین
Sum|جمع کل
First|اول
Primitive|پریمیتیو
Both|هر دو
Bend|خم
Twist|پیچش
Wave|موج
Planar|مسطح
Polar|قطبی
Cylindrical|استوانه‌ای
Spherical|کروی
Minimal torsion|پیچش کمینه
Frenet|فرنه
Loop|حلقه
Once|یک‌بار
Ping-pong|رفت‌وبرگشت
Forward|جلو
Backward|عقب
Centered|مرکزی
Nearest|نزدیک‌ترین
Crossfade|محوشدگی متقاطع
Spin|چرخش
Power|توان
Lerp|درون‌یابی خطی
Modulo|باقی‌مانده
Smoothstep|هموار
Absolute|مطلق
One minus|یک منهای
Remap range|بازنگاشت بازه
Vector|بردار
Curl (flow)|کرل (جریان)
Ease out|کند شدن در پایان
Directional|جهت‌دار
Transparent|شفاف
Squircle|اسکوئرکل
Bricks|آجر
Hex|شش‌ضلعی
Packed (R = A, G = B, B = C, A = alpha)|بسته‌بندی‌شده (R = A, G = B, B = C, A = آلفا)
Single frame|فریم تکی
Image sequence|دنبالهٔ تصویر
Flipbook sheet|شیت فلیپ‌بوک
Single image|تصویر تکی
Sequence (timeline frames)|دنباله (فریم‌های تایم‌لاین)
Turntable sequence|دنبالهٔ گردان
Unreal Engine|آنریل انجین
Unity|یونیتی
Godot|گودو
Linear (data)|خطی (داده)
sRGB (colour)|sRGB (رنگ)
Linear (masks)|خطی (ماسک‌ها)
Additive|افزایشی
Opaque|مات
Coverage|پوشش
Ignore|نادیده گرفتن
Set hue|تنظیم رنگ‌مایه
Random hue|رنگ‌مایه تصادفی
Per pixel|به ازای پیکسل
Per splat|به ازای لکه
Random per island|تصادفی برای هر جزیره
Random per point|تصادفی برای هر نقطه
Random per particle|تصادفی برای هر ذره
By age|بر اساس سن
By time|بر اساس زمان
Point order|ترتیب نقاط
Oldest first (young on top)|قدیمی‌ترین اول (جوان روی)
Youngest first (old on top)|جوان‌ترین اول (قدیمی روی)
One-shot (burst)|یک‌باره (انفجاری)
Loop (continuous)|حلقه (پیوسته)
Smooth Min|حداقل نرم
Smooth Max|حداکثر نرم
Gaussian (pyramid)|گاوسی (هرمی)
Kawase (fast)|کاواسه (سریع)
Exact (2D)|دقیق (۲بعدی)
Separable (fast)|تفکیک‌پذیر (سریع)
Glow only|فقط درخشش
Add to input|افزودن به ورودی
Periodic (seamless)|دوره‌ای (بدون درز)
Clamped (border pinned)|محدود (لبه ثابت)
Preview (average grey + alpha)|پیش‌نمایش (خاکستری میانگین + آلفا)
Along the spline|در امتداد اسپلاین
Away from the spine|دور از ستون
Towards the spine|به سمت ستون
Signed offset|آفست علامت‌دار
Strongest wins|قوی‌ترین برنده
Compose (B after A)|ترکیب (B بعد از A)
Wrap (loop)|پیچش (حلقه)
Wrap (fill)|پیچش (پر کردن)
Empty gaps|شکاف‌های خالی
Follow Tiling|پیروی از تایلینگ
Source frame count|تعداد فریم مبدأ
Frame order|ترتیب فریم‌ها
Flip green (DirectX → OpenGL)|وارونهٔ سبز (DirectX → OpenGL)
Flow range|بازهٔ جریان
Size reference|مرجع اندازه
ID seed|سید شناسه
Rounds (0 = auto)|دورها (۰ = خودکار)
Random invert|وارونهٔ تصادفی
Quantize steps|گام‌های کوانتیزه
Random mirror|آینهٔ تصادفی
Flip Y|وارونهٔ Y
Flip X (red)|وارونهٔ X (قرمز)
Flip Y (green)|وارونهٔ Y (سبز)
Sample distance|فاصلهٔ نمونه
Hard cap|سقف سخت
Outward|به بیرون
Speed random|تصادفی‌سازی سرعت
Size (pscale)|اندازه (pscale)
Size random|تصادفی‌سازی اندازه
Rotation random|تصادفی‌سازی چرخش
Spin turns|دور چرخش
Travel|پیمایش
Drift amount|مقدار رانش
Age random|تصادفی‌سازی سن
Size over age|اندازه بر اساس سن
Color over age|رنگ بر اساس سن
View center|مرکز نما
View width (world)|عرض نما (جهان)
Size scale|مقیاس اندازه
Atlas pick|انتخاب اطلس
Use luminance as alpha|درخشندگی به‌عنوان آلفا
Pin name|نام پین
Alpha when unconnected|آلفا در حالت بی‌اتصال
Value when unconnected|مقدار در حالت بی‌اتصال
Detect by|تشخیص با
Edge range|بازهٔ لبه
Blend type|نوع ترکیب
Clamp 0..1|محدود به ۰..۱
Radial scaling|مقیاس شعاعی
Angular tiling|تایلینگ زاویه‌ای
Radial tiling|تایلینگ شعاعی
Value min|حداقل مقدار
Value max|حداکثر مقدار
Filter strength|قدرت فیلتر
Noise level|سطح نویز
Noise amount|مقدار نویز
Noise contrast|کنتراست نویز
Max distance|حداکثر فاصله
Kind|گونه
Brick offset|آفست آجر
Random per cell|تصادفی برای هر سلول
Angle offset|آفست زاویه
Radius offset|آفست شعاع
Light A (R) azimuth|سمت نور A (R)
Light B (G) azimuth|سمت نور B (G)
Light C (B) azimuth|سمت نور C (B)
Clamp result 0..1|محدود کردن نتیجه به ۰..۱
Start offset (frames)|آفست شروع (فریم)
Time offset (frames)|آفست زمان (فریم)
Loop cross-fade frames|فریم‌های محوشدگی حلقه
Edge padding (px)|حاشیهٔ لبه (px)
Follow graph loop|پیروی از حلقهٔ گراف
Smooth blend|ترکیب نرم
Phase randomness|تصادفی‌سازی فاز
Sample radius|شعاع نمونه
Flat threshold|آستانهٔ تخت
Scale per step|مقیاس در هر گام
Translate per step|جابه‌جایی در هر گام
Rotate per step|چرخش در هر گام
Alpha decay / step|زوال آلفا / گام
Max memory (MB)|حداکثر حافظه (MB)
Step (s)|گام (ثانیه)
Freeze at (s)|ثابت در (ثانیه)
Freeze at time|ثابت در زمان
Colour dilation (px)|گسترش رنگ (px)
Include in "Export all"|شامل در «خروجی همه»
Premultiplied alpha|آلفای پیش‌ضرب‌شده
Frame mode|حالت فریم
Image (data)|تصویر (داده)
Closed|بسته
Utils|ابزارها
Blending|ترکیب‌بندی
Islands|جزیره‌ها
Particle|ذره
Subgraphs|زیرگراف‌ها
Favorites|علاقه‌مندی‌ها
Recent|اخیر
Texture (Import)|تکسچر (وارد کردن)
Model (Import)|مدل (وارد کردن)
Flipbook (Import)|فلیپ‌بوک (وارد کردن)

/* ---- tooltips shared by several nodes (the rest fall back to English; node-specific keys node.ID.param.P.tooltip win) */
The pixel holds the coordinate to read from. Identity = own UV. Graph default.|پیکسل مختصاتِ محل خواندن را نگه می‌دارد. همانی = UV خود پیکسل. پیش‌فرض گراف.
The pixel holds (lookup - own UV). Neutral = 0. Use for export / engine flowmaps.|پیکسل (مختصات جست‌وجو − UV خودش) را نگه می‌دارد. خنثی = ۰. برای خروجی گرفتن / فلومپ موتور.
How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position.|نحوه ذخیره میدان: مختصات مطلق جست‌وجو (پیش‌فرض؛ مورد انتظار Transform / Directional Blur / Noise UV) یا جابه‌جایی نسبت به موقعیت پیکسل.
Name of the pin on the subgraph node.|نام پین روی نود زیرگراف.
Pins are sorted by this value (then by position).|پین‌ها بر اساس این مقدار مرتب می‌شوند (سپس بر اساس موقعیت).
How the connected UV field is stored.|نحوه ذخیره میدان UV متصل‌شده.
Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders.|توکن‌ها: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. نویسه «/» زیرپوشه می‌سازد.
Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot.|قراردادهای کانال / نرمال / جریان و قوانین اعتبارسنجی را برای Unreal، Unity یا Godot تعیین می‌کند.
PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged).|PNG: ۸ / ۱۶. TGA: ۸. EXR: نیم‌اعشار / اعشار. HDR: اعشار. ترکیب‌های نامعتبر اصلاح می‌شوند (و در لاگ ثبت می‌شوند).
Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles.|اندازه‌های غیرمربع و غیرتوان‌دو مجازند. بالاتر از بودجه حافظه، خروجی به‌صورت تایل‌تایل رندر می‌شود.
Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding.|پیکسل‌های لبه را داخل هر سلول تکرار می‌کند (ایمن برای میپ). فریم به اندازه ۲ × حاشیه کوچک‌تر رندر می‌شود.
Centre of the polar mapping (UV).|مرکز نگاشت قطبی (UV).
1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height.|۱ = شعاع دایره محاطی (نصف ضلع کوچک‌تر) به کل ارتفاع منبع نگاشت می‌شود.
Offsets the angle by the distance from the centre: turns of twist per unit radius.|زاویه را بر اساس فاصله از مرکز جابه‌جا می‌کند: تعداد دورهای پیچش در هر واحد شعاع.
p-norm exponent: 2 = circle, large = square.|توان نُرم p: ۲ = دایره، مقدار بزرگ = مربع.
Radial power curve (+ pulls content towards the centre, - pushes it out).|منحنی توانی شعاعی (+ محتوا را به مرکز می‌کشد، − بیرون می‌راند).
Tunnel look: the radius maps through 1/r so texture compresses towards the centre.|حالت تونل: شعاع از 1/r نگاشت می‌شود و تکسچر به سمت مرکز فشرده می‌شود.
Angular range covered by the full width of the polar image.|بازه زاویه‌ای که کل عرض تصویر قطبی پوشش می‌دهد.
Shifts the radial axis of the polar image.|محور شعاعی تصویر قطبی را جابه‌جا می‌کند.
What happens outside the radial / angular range.|رفتار بیرون از بازه شعاعی / زاویه‌ای.
EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear.|EXR / HDR همیشه خطی‌اند. تکسچرهای داده (ماسک، نرمال، وارپ) باید خطی باشند.
Equal min / max = automatic range.|کمینه و بیشینه برابر = بازه خودکار.
Limit the effect to a spherical region (gizmo in the 3D viewport).|اثر را به یک ناحیه کروی محدود می‌کند (گیزمو در نمای ۳بعدی).
Fraction of the smaller image side (resolution independent).|کسری از ضلع کوچک‌تر تصویر (مستقل از وضوح).
Per-pixel offset of the taps; trades banding for fine noise.|جابه‌جایی نمونه‌ها برای هر پیکسل؛ نوارنوار شدن را با نویز ریز عوض می‌کند.
Engine flowmap convention: shaders compute uv - flow * time.|قرارداد فلومپ موتور: شیدرها uv − flow × time را حساب می‌کنند.
0 -> 1 is one seamless loop.|۰ ← ۱ یک حلقه بی‌درز است.
Shear in degrees.|برش (Shear) به درجه.
Optional UV map: aligns / deforms the fractal (see the UV tab).|نقشه UV اختیاری: فراکتال را هم‌راستا / تغییرشکل می‌دهد (زبانه UV را ببینید).
Moves the pattern. The pattern repeats every 100% translation.|الگو را جابه‌جا می‌کند. الگو در هر ۱۰۰٪ جابه‌جایی تکرار می‌شود.
Rotates the grid. While the graph tiles it snaps to 90 degree steps.|شبکه را می‌چرخاند. هنگام تایلینگ گراف روی گام‌های ۹۰ درجه می‌چسبد.
0% and 100% give the same pattern, so animating 0 -> 100% loops seamlessly.|۰٪ و ۱۰۰٪ الگوی یکسانی می‌دهند؛ پس انیمیت ۰ ← ۱۰۰٪ بی‌درز حلقه می‌شود.
Number of grid refinements.|تعداد اصلاح‌های شبکه.
Amplitude change per octave. Negative values alternate / invert octaves.|تغییر دامنه در هر اکتاو. مقادیر منفی اکتاوها را متناوب / وارونه می‌کنند.
Chance that a splat is mirrored horizontally.|احتمال آینه‌شدن افقی یک اسپلت.
Chance that a splat is mirrored vertically.|احتمال آینه‌شدن عمودی یک اسپلت.
100% = the splat fills its cell.|۱۰۰٪ = اسپلت کل سلول خود را پر می‌کند.
0% = regular grid.|۰٪ = شبکه منظم.
Width of the fade between hidden and visible (0% = hard on/off).|پهنای محوشدن بین پنهان و پیدا (۰٪ = روشن/خاموش تیز).
Bleeds colour into fully transparent pixels (mip-safe edges). Needs alpha.|رنگ را به پیکسل‌های کاملاً شفاف نشت می‌دهد (لبه‌های ایمن برای میپ). به آلفا نیاز دارد.
A Gray texture has alpha 1; turn this on to write its value into the alpha channel (masks).|تکسچر خاکستری آلفای ۱ دارد؛ این گزینه را روشن کنید تا مقدارش در کانال آلفا نوشته شود (ماسک‌ها).
0 leaves an axis untouched, 1 applies the full value.|۰ محور را دست‌نخورده می‌گذارد، ۱ مقدار کامل را اعمال می‌کند.
0 displaces both ways, 1 only outwards.|۰ در هر دو جهت جابه‌جا می‌کند، ۱ فقط به بیرون.
Noise origin (gizmo). Animate it to scroll the noise.|مبدأ نویز (گیزمو). برای حرکت دادن نویز آن را انیمیت کنید.
One graph loop = \`cycles\` noise cycles (seamless).|یک حلقه گراف = \`cycles\` چرخه نویز (بی‌درز).

/* ---- sample / template names and tags (start screen) */
Fire Anomaly Orb|گوی آتشین ناهنجاری
Lightning Strike (mask + mesh bolt)|صاعقه (ماسک + مش آذرخش)
Shockwave Ring|حلقه موج شوک
Sword Swipe|ضربه شمشیر
Energy Beam (Sweep)|پرتو انرژی (Sweep)
Hit Impact Decal + Crater|دکال ضربه + دهانه
Magic Circle|دایره جادویی
Tornado Vortex (mesh + scrolling dust)|گردباد (مش + گرد و غبار متحرک)
Plasma Orb (geometry + Accumulate + VAT)|گوی پلاسما (هندسه + Accumulate + VAT)
Stylized Smoke Flipbook (loop)|فلیپ‌بوک دود استایلایز (حلقه)
Tiling Lava / Energy + Normal + Surface Mesh|گدازه / انرژی تایلینگ + نرمال + مش سطح
Glow / Flare / Sprite Pack|بسته درخشش / فلر / اسپرایت
Blooming Flower (petal texture + 3D)|گل شکوفا (تکسچر گلبرگ + سه‌بعدی)
Waterfall (flowing textures + curved mesh)|آبشار (تکسچرهای جاری + مش خمیده)
Neon Sign "VFX" (spline glow + tube mesh)|تابلو نئون «VFX» (درخشش اسپلاین + مش لوله)
Golden Snitch (wings + sparkle trail)|اسنیچ طلایی (بال‌ها + دنباله جرقه)
Fluid Smoke Wisps (advection + mandala)|رشته‌های دود سیال (انتقال + ماندالا)
Hex Energy Shield (impact ripple + dome)|سپر انرژی شش‌ضلعی (موج ضربه + گنبد)
Portal Vortex (spiral arms + ring mesh)|گرداب پورتال (بازوهای مارپیچ + مش حلقه)
Stylized Flame Torch (cel layers + cone mesh)|مشعل شعله استایلایز (لایه‌های سل + مش مخروط)
Water Orb (glass sphere + sloshing liquid)|گوی آب (کره شیشه‌ای + مایع متلاطم)
Blank|خالی
Mesh VFX|افکت مش
Tiling Texture|تکسچر تایلینگ
fire|آتش
orb|گوی
animated|متحرک
particles|ذرات
mesh|مش
lightning|صاعقه
bolt|آذرخش
sweep|Sweep
shockwave|موج شوک
ring|حلقه
warp|وارپ
swipe|ضربه
slash|برش
arc|کمان
beam|پرتو
tiling|تایلینگ
impact|ضربه
decal|دکال
cracks|ترک‌ها
crater|دهانه
magic|جادو
rotation|چرخش
polar scatter|پراکندگی قطبی
tornado|گردباد
vortex|گرداب
plasma|پلاسما
accumulate|انباشت
vat|VAT
smoke|دود
flipbook|فلیپ‌بوک
loop|حلقه
lava|گدازه
normal|نرمال
texture|تکسچر
glow|درخشش
flare|فلر
sprites|اسپرایت‌ها
packed|بسته‌بندی‌شده
flower|گل
bloom|شکوفه
organic|ارگانیک
petal|گلبرگ
stylized|استایلایز
water|آب
waterfall|آبشار
flow|جریان
neon|نئون
spline|اسپلاین
text|متن
sign|تابلو
gold|طلا
wings|بال‌ها
trail|دنباله
sparkle|جرقه
fluid|سیال
wisps|رشته‌ها
curl|کرل
mandala|ماندالا
shield|سپر
forcefield|میدان نیرو
hex|شش‌ضلعی
sci-fi|علمی‌تخیلی
dome|گنبد
portal|پورتال
spiral|مارپیچ
rings|حلقه‌ها
runes|رون‌ها
flame|شعله
torch|مشعل
cel|سل
embers|اخگرها
glass|شیشه
caustics|کاستیک
bubbles|حباب‌ها
liquid|مایع
blank|خالی
vfx|VFX
Template|الگو
Sample projects|پروژه‌های نمونه

/* ---- remaining node-definition phrases (mesh / export / import / filter options) */
Target mesh bounds|کران‌های مش هدف
Frame mesh (x radius)|قاب‌بندی مش (× شعاع)
Kelvin at 0%|کلوین در ۰٪
Kelvin at 100%|کلوین در ۱۰۰٪
Temperature curve|منحنی دما
Emission curve|منحنی نورافشانی
Opaque (1)|مات (۱)
From temperature|از دما
Alpha from|آلفا از
Alpha to|آلفا تا
Filmic tonemap (LDR preview)|تون‌مپ سینمایی (پیش‌نمایش LDR)
Grid scale|مقیاس شبکه
Add Z axis|افزودن محور Z
Pyramid|هرم
Regular polygon|چندضلعی منتظم
Regular star|ستاره منتظم
Single pixel|تک پیکسل
Secondary size|اندازه ثانویه
Max smoothness|حداکثر نرمی
Octave blending|ترکیب اکتاوها
Fractional Brownian Motion|حرکت براونی کسری
Mix (ramp)|ترکیب (رمپ)
Multiply (ramp)|ضرب (رمپ)
Screen (ramp)|اسکرین (رمپ)
Blending ramp|رمپ ترکیب
Horizontal scale min|حداقل مقیاس افقی
Horizontal scale max|حداکثر مقیاس افقی
Vertical scale min|حداقل مقیاس عمودی
Vertical scale max|حداکثر مقیاس عمودی
H/V randomization scale|مقیاس تصادفی‌سازی افقی/عمودی
Quincunx|پنج‌نقطه‌ای (کوینکانکس)
Offset rows|جابه‌جایی سطرها
Offset columns|جابه‌جایی ستون‌ها
Visibility transition width|پهنای گذار دیده‌شدن
Gradient (random per splat)|گرادیان (تصادفی برای هر اسپلت)
Gradient by splat profile|گرادیان بر اساس پروفایل اسپلت
Color gain (HDR)|بهره رنگ (HDR)
Opaque (color on black)|مات (رنگ روی سیاه)
Shift input hue|جابه‌جایی رنگمایه ورودی
A|A
B|B
Linear RGB|RGB خطی
OKLab (perceptual)|OKLab (ادراکی)
Additive (bake alpha, a = 0)|افزایشی (پخت آلفا، a = 0)
Opaque (a = 1)|مات (a = 1)
Epsilon|اپسیلون
Ignore lightness|نادیده گرفتن روشنایی
Keep lightness|حفظ روشنایی
None (manual)|هیچ (دستی)
PNG|PNG
TGA|TGA
OpenEXR|OpenEXR
Radiance HDR|Radiance HDR
DDS (uncompressed)|DDS (بدون فشرده‌سازی)
8-bit|۸ بیتی
16-bit|۱۶ بیتی
Half float (16f)|نیم‌اعشار (16f)
Float (32f)|اعشار (32f)
Auto (by kind / engine)|خودکار (بر اساس نوع / موتور)
sRGB|sRGB
EXR compression|فشرده‌سازی EXR
ZIP (16 lines)|ZIP (۱۶ خط)
From graph|از گراف
Multiplier|ضریب
Absolute (pixels)|مطلق (پیکسل)
Width / height multiplier|ضریب عرض / ارتفاع
Width / height (px)|عرض / ارتفاع (px)
Frame count (0 = graph loop)|تعداد فریم (۰ = حلقه گراف)
Cell edge padding (px)|حاشیه لبه سلول (px)
Also write every frame as a file|هر فریم به‌صورت فایل جداگانه هم نوشته شود
Store as RGB (gray replicated)|ذخیره به‌صورت RGB (خاکستری تکرار می‌شود)
Mesh (single frame)|مش (تک‌فریم)
Mesh flipbook (all frames in one mesh)|فلیپ‌بوک مش (همه فریم‌ها در یک مش)
VAT soft body|VAT جسم نرم
VAT rigid body (pieces)|VAT جسم صلب (قطعه‌ها)
Pivot-baked mesh|مش با پیوت پخته‌شده
GLB (binary glTF)|GLB (glTF دودویی)
glTF + .bin|glTF + .bin
OBJ|OBJ
PLY (binary)|PLY (دودویی)
Axes / handedness|محورها / جهت‌دستی
From engine preset|از پیش‌تنظیم موتور
Z up, right handed (as authored)|Z بالا، راست‌دست (مثل اصل)
glTF: Y up, right handed|glTF: Y بالا، راست‌دست
Unity: Y up, left handed|Unity: Y بالا، چپ‌دست
Unreal: Z up, left handed (X forward)|Unreal: Z بالا، چپ‌دست (X جلو)
Unit scale (0 = engine default)|مقیاس واحد (۰ = پیش‌فرض موتور)
Custom attributes (pscale, age, id ...)|اتریبیوت‌های سفارشی (pscale، age، id ...)
Frame (first frame)|فریم (اولین فریم)
VAT|VAT
EXR half float (raw)|EXR نیم‌اعشار (خام)
EXR float (raw)|EXR اعشار (خام)
PNG 16-bit (normalised)|PNG ۱۶ بیتی (نرمال‌شده)
PNG 8-bit (normalised, coarse)|PNG ۸ بیتی (نرمال‌شده، خشن)
Store offset from frame 0|ذخیره جابه‌جایی نسبت به فریم ۰
Write normal texture|نوشتن تکسچر نرمال
Loops (metadata)|حلقه‌ها (فراداده)
Centroid|مرکز ثقل
Bounds centre|مرکز کران‌ها
Bounds base (min Z)|پایه کران‌ها (کمینه Z)
Bounds top (max Z)|بالای کران‌ها (بیشینه Z)
Pivot encoding|کدگذاری پیوت
Attributes only|فقط اتریبیوت‌ها
UV sets (xy, z + random id)|مجموعه‌های UV (xy، z + شناسه تصادفی)
Vertex colour (xyz + random id in A)|رنگ رأس (xyz + شناسه تصادفی در A)
Take channel|انتخاب کانال
R|R
G|G
Levels black|سیاه لولز
Levels white|سفید لولز
Levels gamma|گامای لولز
Written channels|کانال‌های نوشته‌شده
RGBA (4 channels)|RGBA (۴ کانال)
RGB (3 channels)|RGB (۳ کانال)
Y convention|قرارداد Y
OpenGL (Y+)|OpenGL (Y+)
DirectX (Y−)|DirectX (Y−)
XYZ|XYZ
XYZ, Z reconstructed|XYZ، Z بازسازی‌شده
RG only (BC5 style, B = 0)|فقط RG (سبک BC5، B = 0)
2D view (Color input)|نمای ۲بعدی (ورودی رنگ)
3D view (Mesh input)|نمای ۳بعدی (ورودی مش)
PNG (8-bit)|PNG (۸ بیتی)
TGA (8-bit)|TGA (۸ بیتی)
2x2|۲×۲
3x3|۳×۳
4x4|۴×۴
3x3 tiling preview|پیش‌نمایش تایلینگ ۳×۳
Safe frames overlay (90% / 80%)|پوشش قاب‌های امن (۹۰٪ / ۸۰٪)
Matcap|Matcap
PBR|PBR
Unlit|بدون نور
Vertex colour|رنگ رأس
Wireframe|سیمی (Wireframe)
Material blend|ترکیب متریال
Turntable degrees|درجه صفحه گردان
Turntable elevation offset|جابه‌جایی ارتفاع صفحه گردان
UV input|ورودی UV
Absolute (lookup)|مطلق (جست‌وجو)
Offset (warp)|جابه‌جایی (وارپ)
Absolute coordinates (RG)|مختصات مطلق (RG)
Signed offset (RG, float)|جابه‌جایی علامت‌دار (RG، اعشار)
Biased offset 0.5 = neutral (flowmap)|جابه‌جایی با بایاس (۰٫۵ = خنثی، فلومپ)
Direction (RG) + speed (B)|جهت (RG) + سرعت (B)
Range scale|مقیاس بازه
Vector means|معنای بردار
Flow (content moves along the vector)|جریان (محتوا در جهت بردار حرکت می‌کند)
Lookup offset (raw warp)|جابه‌جایی جست‌وجو (وارپ خام)
Flip Y (bottom-up engines)|وارونه‌سازی Y (موتورهای پایین‌به‌بالا)
Write encoding JSON|نوشتن JSON کدگذاری
Texture -> vertex data|تکسچر ← داده رأس
Pivots per island|پیوت برای هر جزیره
Record animation (frame buffers)|ضبط انیمیشن (بافر فریم‌ها)
Re-bake (change to capture again)|پخت دوباره (برای ضبط مجدد تغییر دهید)
LUMA|LUMA
RGB|RGB
RGBA|RGBA
Bounds center|مرکز کران‌ها
Pivot to UV set (-1 off)|پیوت به مجموعه UV (-۱ خاموش)
Record normals|ضبط نرمال‌ها
Uniform color|رنگ یکنواخت
Texture via UV|تکسچر از طریق UV
Gradient along axis|گرادیان در امتداد محور
Radial gradient (around axis)|گرادیان شعاعی (دور محور)
Gradient along attribute / length|گرادیان در امتداد اتریبیوت / طول
3D noise|نویز سه‌بعدی
Gray value -> alpha|مقدار خاکستری ← آلفا
Gradient origin|مبدأ گرادیان
Gradient direction|جهت گرادیان
Gradient length|طول گرادیان
Perlin (4D, loops exactly)|پرلین (۴بعدی، حلقه دقیق)
Simplex (loop by cross-fade)|سیمپلکس (حلقه با کراس‌فید)
Auto (vertex for textures)|خودکار (رأس برای تکسچرها)
Uniform value|مقدار یکنواخت
Min (source = 0)|کمینه (منبع = ۰)
Max (source = 1)|بیشینه (منبع = ۱)
Attribute range min|کمینه بازه اتریبیوت
Attribute range max|بیشینه بازه اتریبیوت
Remap with curve|بازنگاشت با منحنی
pscale (uniform)|pscale (یکنواخت)
scale (vec3)|scale (vec3)
Axis weights (scale)|وزن محورها (مقیاس)
Multiply existing scale|ضرب در مقیاس موجود
Pscale|Pscale
X|X
Y|Y
Z|Z
Input min|کمینه ورودی
Input max|بیشینه ورودی
Translate at 1|جابه‌جایی در ۱
Along normal at 1|در امتداد نرمال در ۱
Rotate at 1|چرخش در ۱
Scale at 1|مقیاس در ۱
Align to normal (if no orient)|هم‌راستا با نرمال (بدون orient)
Use scale (vec3)|استفاده از scale (vec3)
Multiply by point color|ضرب در رنگ نقطه
Rotate offset|جابه‌جایی چرخش
Pscale start|شروع Pscale
pscale attribute|اتریبیوت pscale
Pscale end|پایان Pscale
Age start|شروع age
age attribute|اتریبیوت age
Age end|پایان age
Vertex color R|رنگ رأس R
Vertex color G|رنگ رأس G
Vertex color B|رنگ رأس B
Vertex color A|رنگ رأس A
Attribute (name)|اتریبیوت (نام)
Gray texture via UV|تکسچر خاکستری از طریق UV
Inside box|داخل جعبه
Primitive centers|مراکز پریمیتیوها
Island centers|مراکز جزیره‌ها
Island center|مرکز جزیره
Keep every n-th|نگه‌داشتن هر n‌ام
pscale|pscale
Keep existing|حفظ موجود
From element size|از اندازه عنصر
Build orient from N|ساخت orient از N
Along normal|در امتداد نرمال
Noise vector|بردار نویز
Along axis|در امتداد محور
Perlin (4D, exact loop)|پرلین (۴بعدی، حلقه دقیق)
Frequency scale (per axis)|مقیاس فرکانس (هر محور)
Speed (noise units / s)|سرعت (واحد نویز / ثانیه)
Write \`noise\` attribute|نوشتن اتریبیوت \`noise\`
Recompute normals (angle weighted)|محاسبه دوباره نرمال‌ها (وزن‌دار با زاویه)
Write tangents|نوشتن مماس‌ها
Tangent UV set|مجموعه UV مماس
Grid divisions|تقسیمات شبکه
Orient to normal|جهت‌دهی به نرمال
Tube|لوله
Hemisphere|نیم‌کره
Arc strip|نوار کمانی
Cross plane|صفحه متقاطع
Crater|دهانه (کرتر)
Base (min Z at 0)|پایه (کمینه Z در ۰)
Uv mode|حالت UV
Spherify|کروی‌سازی
Lattice (free-form)|شبکه (آزاد)
Displace by texture|جابه‌جایی با تکسچر
Warp space position|موقعیت وارپ فضا
Warp space rotation|چرخش وارپ فضا
Lattice box center|مرکز جعبه شبکه
Lattice box size|اندازه جعبه شبکه
Grid resolution|وضوح شبکه
Corner 0 (-x -y -z)|گوشه ۰ (-x -y -z)
Corner 1 (+x -y -z)|گوشه ۱ (+x -y -z)
Corner 2 (-x +y -z)|گوشه ۲ (-x +y -z)
Corner 3 (+x +y -z)|گوشه ۳ (+x +y -z)
Corner 4 (-x -y +z)|گوشه ۴ (-x -y +z)
Corner 5 (+x -y +z)|گوشه ۵ (+x -y +z)
Corner 6 (-x +y +z)|گوشه ۶ (-x +y +z)
Corner 7 (+x +y +z)|گوشه ۷ (+x +y +z)
Displace along|جابه‌جایی در امتداد
C|C
D|D
Resample|نمونه‌برداری مجدد
Points / sides|نقاط / ضلع‌ها
Star inner radius|شعاع داخلی ستاره
Point scale|مقیاس نقطه
Align to tangent|هم‌راستا با مماس
Twist at curve = 1|پیچش در منحنی = ۱
Per-point scale / twist|مقیاس / پیچش هر نقطه
V offset (scroll)|جابه‌جایی V (اسکرول)
V in world units|V در واحد جهان
Vertex colour gradient|گرادیان رنگ رأس
Color along length|رنگ در امتداد طول
Planar axis|محور مسطح
Projection volume|حجم تصویرسازی
Uv scale|مقیاس UV
Uv offset|جابه‌جایی UV
Uv rotation|چرخش UV
Height scale|مقیاس ارتفاع
Contrast (power)|کنتراست (توان)
Both (50% = flat)|هر دو (۵۰٪ = تخت)
Grow (dilate)|رشد (اتساع)
Shrink (erode)|کوچک‌سازی (فرسایش)
Open|باز
Close|بستن
Square|مربع
Diamond|لوزی
Octagon|هشت‌ضلعی
High-pass|بالاگذر
3 x 3|۳ × ۳
5 x 5|۵ × ۵
Angular|زاویه‌ای
Reflected|بازتابی
Repeat (sawtooth)|تکرار (دندانه‌اره‌ای)
Mirror (triangle)|آینه (مثلثی)
UV amount|مقدار UV
Jaggedness|دندانه‌دندانه‌بودن
Base segments|قطعات پایه
Head softness|نرمی سر
Gabor|گابور
Worley F1|ورلی F1
Worley F2|ورلی F2
Worley F2-F1|ورلی F2-F1
Voronoi (border distance)|ورونوی (فاصله تا مرز)
Kernel frequency|فرکانس هسته
Kernel angle|زاویه هسته
Orientation randomness|تصادفی‌بودن جهت
fBm|fBm
Gain (roughness)|بهره (زبری)
Octave rotation|چرخش اکتاو
Warp frequency|فرکانس وارپ
Remap in low|بازنگاشت ورودی پایین
Remap in high|بازنگاشت ورودی بالا
First ring radius|شعاع حلقه اول
Last ring radius|شعاع حلقه آخر
Elements per ring|عناصر در هر حلقه
Count mode|حالت شمارش
Proportional to radius|متناسب با شعاع
Count growth per ring|رشد تعداد در هر حلقه
Spiral (angle per ring)|مارپیچ (زاویه برای هر حلقه)
Spin (turns per loop)|چرخش (دور در هر حلقه زمانی)
Alternate spin direction|جهت چرخش متناوب
Size randomness|تصادفی‌بودن اندازه
Rotation randomness|تصادفی‌بودن چرخش
Star inner size|اندازه داخلی ستاره
Scale at last ring|مقیاس در حلقه آخر
Align to radius|هم‌راستا با شعاع
Rotation offset|جابه‌جایی چرخش
Rotation per ring|چرخش هر حلقه
Overlap blending|ترکیب هم‌پوشانی
Front sharpness|تیزی جلو
Tail length|طول دنباله
Strokes per glyph|ضربه برای هر نشانه
Vertical stem|ساقه عمودی
Mirror symmetric|تقارن آینه‌ای
Border circles|دایره‌های مرزی
Pie|پای
Line / capsule|خط / کپسول
Drop|قطره
Bevel profile|پروفایل پخ
Outline (centred)|طرح کلی (مرکزی)
Spline 1|اسپلاین ۱
Spline 2|اسپلاین ۲
Spline 3|اسپلاین ۳
Spline 4|اسپلاین ۴
Round|گرد
Round (tube)|گرد (لوله)
Cone (ridge)|مخروط (برجستگی)
Length randomness|تصادفی‌بودن طول
Odd ray length|طول پرتوهای فرد
XDoG|XDoG
Scale ratio (k)|نسبت مقیاس (k)
Phi|فی
Cols|ستون‌ها
sRGB → linear|sRGB ← خطی
As authored|مثل اصل
Y-up → Z-up|Y-بالا ← Z-بالا
Z-up → Y-up|Z-بالا ← Y-بالا
Base centre|مرکز پایه
UV V|V در UV
Auto (glTF flips V)|خودکار (glTF مقدار V را برعکس می‌کند)
Flip V|وارونه‌سازی V
Keep V|حفظ V
Downscale on import|کوچک‌سازی هنگام وارد کردن
8192|8192
4096|4096
2048|2048
1024|1024
512|512
Fit graph size|هم‌اندازه با گراف
Gray source|منبع خاکستری
UV decode|رمزگشایی UV
Absolute (RG = lookup)|مطلق (RG = جست‌وجو)
Biased flowmap (0.5 = neutral)|فلومپ با بایاس (۰٫۵ = خنثی)
ID|شناسه
4-connected|۴-همسایگی
8-connected|۸-همسایگی
16,384|16,384
65,536|65,536
262,144|262,144
Expand bounding boxes|گسترش جعبه‌های محاصره‌ای
Sample input at centre|نمونه‌برداری ورودی در مرکز
Saturation range|بازه اشباع
Value range|بازه مقدار
Outside islands|خارج از جزیره‌ها
From centre|از مرکز
Edge to centre (box)|لبه تا مرکز (جعبه)
Wrap (repeat / offset)|پیچش (تکرار / جابه‌جایی)
Box area|مساحت جعبه
Box width|عرض جعبه
Box height|ارتفاع جعبه
Aspect (wide = high)|نسبت (عریض = بلند)
Position X|موقعیت X
Position Y|موقعیت Y
Distance from centre|فاصله از مرکز
Stretch to box|کشیده شدن تا جعبه
Fit (keep aspect, letterbox)|جا دادن (حفظ نسبت، با حاشیه)
Fill (keep aspect, crop)|پر کردن (حفظ نسبت، با برش)
Random 90° steps|گام‌های تصادفی ۹۰ درجه
Align long axis|هم‌راستاسازی محور بلند
RGB (as stored)|RGB (همان‌گونه که ذخیره شده)
RG (reconstruct Z)|RG (بازسازی Z)
DXT5nm (A = X, G = Y)|DXT5nm (A = X، G = Y)
Reoriented (RNM)|جهت‌دهی‌مجدد (RNM)
Detail (UDN)|جزئیات (UDN)
Whiteout|وایت‌اوت
Partial derivative|مشتق جزئی
4-way (central difference)|۴ جهته (تفاضل مرکزی)
8-way Sobel|سوبل ۸ جهته
8-way Scharr|شار ۸ جهته
OpenGL (+Y up) — Unity, Godot|OpenGL (+Y بالا) — Unity، Godot
DirectX (-Y) — Unreal|DirectX (-Y) — Unreal
Reconstruct Z from X, Y|بازسازی Z از X و Y
Use Z input (normalize)|استفاده از ورودی Z (نرمال‌سازی)
Encoded (50% = 0)|کدگذاری‌شده (۵۰٪ = ۰)
Magnitude |n||بزرگی (طول n)
Positive part|بخش مثبت
Encoded RGB (0.5 neutral)|RGB کدگذاری‌شده (۰٫۵ خنثی)
Signed vector (float)|بردار علامت‌دار (اعشار)
Two channel RG|دو کانال RG
XY|XY
XZ|XZ
YZ|YZ
Turbulence freq|فرکانس تلاطم
Snap travel to whole boxes|چسباندن حرکت به جعبه‌های کامل
Drift freq|فرکانس رانش
Drift cycles|چرخه‌های رانش
Life cycles|چرخه‌های عمر
Alpha (over)|آلفا (روی)
Trail (loop fraction)|دنباله (کسر حلقه)
Atlas cols|ستون‌های اطلس
Atlas rows|سطرهای اطلس
Atlas frames|فریم‌های اطلس
Stretch to fill|کشیدن تا پر شدن
Any channel|هر کانال
Max (Lighten)|بیشینه (روشن‌تر)
Min (Darken)|کمینه (تیره‌تر)
Color Dodge|رنگ‌روشن‌کن (Color Dodge)
Color Burn|رنگ‌سوزان (Color Burn)
Linear Light|نور خطی
Cross mix|ترکیب متقاطع
Axis radius|شعاع محور
Euclidean (circular)|اقلیدسی (دایره‌ای)
Chebyshev (square)|چبیشف (مربعی)
Squircle factor|ضریب مربع‌گرد
Radial centering|مرکزگرایی شعاعی
Out of range|خارج از بازه
Overlap range|بازه هم‌پوشانی
Overlap scale|مقیاس هم‌پوشانی
Radial (lens)|شعاعی (عدسی)
Position randomness|تصادفی‌بودن موقعیت
Over (last on top)|روی (آخری بالا)
Patch|پچ
Cross (5 taps)|ضربدری (۵ نمونه)
Square (9 taps)|مربعی (۹ نمونه)
UV scale|مقیاس UV
Trail (linear)|دنباله (خطی)
Sobel|سوبل
Prewitt|پرویت
Scharr|شار
Laplacian|لاپلاسین
Frequency gain|بهره فرکانس
Step decay|افت گام
Min threshold|حداقل آستانه
Span|گستره
Reduce mul|ضریب کاهش
Bloom scales|مقیاس‌های بلوم
Cells + lines|سلول‌ها + خطوط
Line level|سطح خط
HSVA|HSVA
Radial (wedges)|شعاعی (گوه‌ها)
Mirrored grid|شبکه آینه‌ای
Point 1, 1|نقطه ۱، ۱
Point 2, 1|نقطه ۲، ۱
Point 3, 1|نقطه ۳، ۱
Point 4, 1|نقطه ۴، ۱
Point 1, 2|نقطه ۱، ۲
Point 2, 2|نقطه ۲، ۲
Point 3, 2|نقطه ۳، ۲
Point 4, 2|نقطه ۴، ۲
Point 1, 3|نقطه ۱، ۳
Point 2, 3|نقطه ۲، ۳
Point 3, 3|نقطه ۳، ۳
Point 4, 3|نقطه ۴، ۳
Point 1, 4|نقطه ۱، ۴
Point 2, 4|نقطه ۲، ۴
Point 3, 4|نقطه ۳، ۴
Point 4, 4|نقطه ۴، ۴
Value (B)|مقدار (B)
Value 2|مقدار ۲
In range|بازه ورودی
Out range|بازه خروجی
Zoom + Spin|بزرگ‌نمایی + چرخش
Sharp radius|شعاع تیز
Sharp transition|گذار تیز
Luminance (Rec.709)|درخشندگی (Rec.709)
Luma (Rec.601)|لوما (Rec.601)
Custom weights|وزن‌های سفارشی
R when unconnected|R هنگام اتصال‌نداشتن
G when unconnected|G هنگام اتصال‌نداشتن
B when unconnected|B هنگام اتصال‌نداشتن
A when unconnected|A هنگام اتصال‌نداشتن
Rate (frames / s)|نرخ (فریم / ثانیه)
Loop length|طول حلقه
Foreground height offset|جابه‌جایی ارتفاع پیش‌زمینه
Outside tile|بیرون از تایل
U|U
V|V
Gray means|معنای خاکستری
Absolute (gray = coordinate)|مطلق (خاکستری = مختصات)
Biased offset (50% = neutral)|جابه‌جایی با بایاس (۵۰٪ = خنثی)
Gray holds|خاکستری نگه می‌دارد
Multiply (A x B / reference)|ضرب (A × B / مرجع)
Scale A|مقیاس A
Scale B|مقیاس B
Input A mode|حالت ورودی A
Input B mode|حالت ورودی B
UV A|UV A
UV B|UV B
Flow field input|ورودی میدان جریان
Randomness cells|سلول‌های تصادفی
Slope (proportional)|شیب (متناسب)
Normalized direction|جهت نرمال‌شده
Downhill (content flows down)|سراشیبی (محتوا پایین می‌رود)
Uphill|سربالایی
Angle (constant speed)|زاویه (سرعت ثابت)
Constant (hard edge)|ثابت (لبه تیز)
Swirl (rotate)|گردابی (چرخش)
Tangent flow (vortex)|جریان مماسی (گرداب)
`;

/** Parsed table: English -> Persian. */
export const FA_TERMS: Record<string, string> = Object.fromEntries(
  (RAW + FA_SIM_RAW + FA_9B_RAW).split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf('|');
      return [l.slice(0, i), l.slice(i + 1)] as [string, string];
    }),
);

/** Suffixes appended by the Color / Points / Gray ... variants of a node title. */
export const FA_TITLE_SUFFIX: Record<string, string> = { Color: 'رنگ', Points: 'نقاط', Gray: 'خاکستری', Mesh: 'مش', Normal: 'نرمال', UV: 'UV', Import: 'وارد کردن' };
