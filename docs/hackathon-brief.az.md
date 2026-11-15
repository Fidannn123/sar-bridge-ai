# SAR-BRIDGE — 2026 hackathon strategiyası

Status: tətbiqin hazır funksiyaları və növbəti elmi yoxlamalar üçün komanda brifi. İnsan baxışı lokal nümayiş kimi işləyir; çoxistifadəçili ekspert təsdiqi xidməti deyil.

Challenge: **2026 NASA Space Apps — Dancing with the SARs**. Uyğunluq istifadəçinin təqdim etdiyi tam challenge mətninə əsaslanır. Yerləşdirmə: https://sar-bridge-ai.onrender.com/

## Məhsulun əsas vədi

SAR-BRIDGE NISAR radar müşahidələrində su ilə örtülmüş sahənin harada və nə qədər dəyişdiyini göstərir, mümkün izahları müstəqil məlumatlarla müqayisə edir və nəticəni alim, ekoloq və resurs idarəçisinin yoxlamasına təqdim edir.

İnsan son qərarı verir. Sistem bəndin təhlükəsizliyini sertifikatlaşdırmır, su səviyyəsini təkcə su sahəsindən hesablamır və iki müşahidədən gələcək hadisə proqnozu çıxarmır.

## Challenge ilə uyğunluq

| Challenge-in istəyi | SAR-BRIDGE-də qarşılığı | Vəziyyət |
|---|---|---|
| NISAR məlumatından istifadə | Eyni track/frame üzrə iki GCOV müşahidəsi, HH/HV | Hazır |
| Səth dəyişikliyini göstərmək | Radar üzrə su itkisi/artımı, hektarla ölçü, sektor xəritəsi | Hazır |
| İnteraktiv və anlaşılan rəqəmsal təqdimat | Before/After, sektor seçimi, Observe → Compare → Explain | Hazır |
| Əlavə məlumatla kontekst | Sentinel-2, ERA5/ERA5-Land, OSM su anbarı konturu və bənd nöqtəsi | Hazır |
| Fiziki səbəblər barədə hipotez | Qayda əsaslı sübut mühərriki və məhdudlaşdırılmış LLM izahı | Hazır; səbəbin sübutu deyil |
| İnsan üçün faydalı nəticə | Mənbəli sektor hesabatı və çatışmayan sübutlar | Hazır |
| İnsan yoxlamasının görünməsi | Yoxlama növbəsi, əsaslandırılmış rəy, izahın mübahisələndirilməsi və əlavə sübut istəyi | Hazır; brauzerdə lokal saxlanır, kimlik təsdiqlənmir |
| Dəyişiklik müqayisəsi | Optik istinada qarşı sinif üzrə saylar, precision/recall/F1/IoU və məhdudiyyətlər | Hazır; sahə həqiqəti ilə validasiya deyil |
| İnfrastrukturla əlaqə | Dəyişmiş sahə ilə yol/obyekt yaxınlığının mənbəli göstərilməsi | Hələ hazır deyil |

Proqnoz, Sentinel-1 və deformasiya bu challenge-in məcburi komponentləri deyil. Pilot üçün tək bir maraqlı ərazi seçmək təqdim edilmiş tapşırığa uyğundur.

## Scope qərarı

Bir əsas dəyişiklik ailəsi: **su örtüyünün azalması/artması və sahilboyu dəyişiklik**. İnfrastruktur yaxınlığı bu hadisənin kontekstidir; ayrıca anomaliya modeli deyil.

Hazırkı iki-tarixli nəticəni “ölçülmüş dəyişiklik” adlandırmaq lazımdır. Onun mövsümi normadan kənar statistik anomaliya olduğunu demək üçün uyğun tarixçə və müqayisə bazası yoxdur.

Mingəçevir ilkin demonstrasiya və metod sınağı kimi qalır. Xəzərin seçilmiş kiçik sahil hissəsi növbəti regional yoxlama sahəsidir. Mingəçevir nəticələri Xəzərdə doğruluq və ya eyni fiziki səbəbin sübutu sayılmır. Əgər əlavə Xəzər məlumatı etibarlı şəkildə hazır olmazsa, xəritədə emal olunmuş pilot kimi göstərilməməlidir.

## Mövcud nəticələrin düzgün təqdimatı

Mənbə: `web/data/stats.json`, `web/data/analysis.json`, `web/data/meta.json`.

- NISAR müşahidələri: 25 iyun və 11 oktyabr 2026; 108 gün.
- Qayda və hədlərlə hesablanmış radar su itkisi: 495,2 ha; radar su artımı: 0,0 ha.
- Etibarlı radar məlumatı olan analiz zonasının payı: 99,99%. Bu, model dəqiqliyi deyil.
- Eyni gündə radar və Sentinel-2 su maskalarının uyğunluğu: 86,5%. Bu, dəyişiklik aşkarlama dəqiqliyi, AI dəqiqliyi və ya səbəbin düzgünlüyü deyil.
- 3-cü sektorda radar su itkisi: 34,3 ha. Qayda mühərrikinin nəticəsi: “Supported hypothesis”. Bu status ekspert təsdiqi deyil.
- Bütün ərazi üzrə nəticə: “Insufficient evidence”. Sektor nümunəsi ümumi ərazi üzrə səbəbin müəyyən edildiyi kimi təqdim edilməməlidir.
- Radar və optik dəyişikliklərin yerləşməsi tam uyğun gəlmir. Bu fərq validasiyanın əsas araşdırma mövzularından biridir.

Hazır HH dəyişiklik qaydası: su/quru sinfi dəyişir, HH siqnalı ən azı 3 dB dəyişir və kiçik sahələr süzülür; minimum saxlanılan dəyişiklik sahəsi 1 ha-dır. Bunlar pipeline parametrləridir, hər şəraitdə doğrunu müəyyən edən universal hədlər deyil. 20 m analiz toru eyni ölçüdə mövqe dəqiqliyinə zəmanət vermir.

## AI-nin ölçülə bilən rolu

1. Geoməkan pipeline-ı siqnalı emal edir və sahəni hesablayır. Hazırda bunu təlim edilmiş neyron şəbəkə kimi təqdim etməmək lazımdır.
2. Qayda mühərriki müşahidələrin hipotezi dəstəklədiyini, ziddiyyət yaratdığını və ya çatışmadığını ayırır.
3. LLM həmin strukturlaşdırılmış nəticəni anlaşılan dilə çevirir; peyk şəklindən özü hektar və deformasiya ölçmür.
4. İnsan nəticəni yoxlayır, izahı mübahisələndirir və ya əlavə sübut istəyir. İnterfeysdə bu addım artıq var: baxan şəxsin adı, vaxt, məlumat versiyası, rəy, əsaslandırma, sübut istinadı və növbəti addım brauzerdə saxlanır, JSON və hesabat kimi çıxarılır. Bu, lokal nümayişdir; istifadəçi kimliyi təsdiqlənmir və çoxistifadəçili server xidməti deyil.

Hazır insan baxışı funksiyasının axını:

`Hesablanmış nəticə → ekspert baxışını gözləyir → rəy və sübut → baxış tamamlandı / əlavə məlumat tələb olunur → insan qərarı`

“Ekspert baxışı tamamlandı” və “hipotez dəstəklənir” ayrı statuslardır. Ekspert baxışının özü də səbəbin qəti sübutu deyil.

Qeyd saxlanılmalıdır: baxan şəxs, vaxt, məlumat/analiz versiyası, nəticə, əsaslandırma və əlavə sübutun istinadı. Çoxistifadəçili real iş axını serverdə saxlanma tələb edir; yalnız brauzerdə saxlanan nümayiş belə etiketlənməlidir.

## Validasiya və uğur ölçüləri

| Nəyi qiymətləndiririk? | Ölçü | Nə ilə müqayisə edilir? |
|---|---|---|
| Su/quru təsnifatı | Precision, recall, F1 və ya IoU | Müstəqil işarələnmiş istinad nümunələri; optik istinadın da məhdudiyyətləri göstərilir |
| Dəyişiklik aşkarlanması | Su itkisi/artımı sinifləri üçün ayrıca precision/recall | Yalnız sabit ərazilərin ümumi uyğunluğuna əsaslanmayan qiymətləndirmə |
| İzahın məlumatlara bağlılığı | Mənbəsiz rəqəm, status dəyişdirilməsi və əsassız səbəb iddiası sayı | Strukturlaşdırılmış ölçülər və sübut paketi |
| İnsan üçün fayda | Baxış vaxtı, ekspertin rədd etdiyi nəticələrin payı, əlavə məlumat istəkləri | Eyni işlərin köməkçi olmadan və köməkçi ilə yoxlanması |

Bu göstəricilər üçün nəticə ölçülməmiş faizlər və biznes qənaəti uydurulmamalıdır. 86,5% maska uyğunluğu yuxarıdakı testlərin əvəzi deyil.

Hazır paket üzrə müstəqil optik dəyişiklik müqayisəsi hesablanıb: 2 091 430 ortaq etibarlı piksel üzərində su itkisi precision 0,194, recall 0,105, F1 0,136, IoU 0,073-dür. 3-cü sektorun itkisi üzrə F1 0,210-dur. Bu zəif uyğunluq yoxlama tələb edir. Optik istinad sahə həqiqəti deyil; fərqli tarix, sahil zolağı, sinifləndirmə və qeydiyyat fərqləri nəzərə alınmalıdır. Nəticəni gizlətmək və ya 86,5%-i dəyişiklik dəqiqliyi adlandırmaq olmaz. Saylar və formulalar Validation bölməsində açıqdır.

Araşdırma prioriteti gələcəkdə dəyişiklik ölçüsü, məlumat keyfiyyəti, müstəqil sübut və obyekt yaxınlığı ilə şəffaf qaydada verilə bilər. Məlumatı çatışmayan sahə “aşağı risk” sayılmamalıdır. Obyektə yaxınlıq zərər və ya təhlükə ehtimalı deyil.

## RACI — məsuliyyət insanlarda qalır

R: işi icra edir. A: yekun məsuliyyəti daşıyır. C: məsləhətləşilir. I: məlumatlandırılır.

| İş | Data/texniki mütəxəssis | Elmi rəhbər | Sahə eksperti | Qərar sahibi / operator |
|---|---|---|---|---|
| Məlumatın gətirilməsi və emal | R | A | C | I |
| Təhlil və hipotez hesabatı | R | A | C | I |
| Müstəqil yoxlama | C | R | A | I |
| Araşdırma prioritetinin müəyyənləşdirilməsi | R | C | R | A |
| Yekun fəaliyyət qərarı | I | C | C | A/R |

AI bu işlərin texniki alətidir; A rolunu daşımır. NASA/ISRO/ESA məlumat təminatçılarıdır. Komanda ilə ayrıca əməkdaşlıq olmadıqca onların sizin nəticənizi yoxladığını və təsdiqlədiyini demək olmaz.

## Proqnoz və deformasiya üçün mərhələ qapıları

Hazır MVP axını:

`Məlumat → keyfiyyət yoxlaması → ölçülmüş dəyişiklik → sübut və hipotezlər → ekspert yoxlaması → insan qərarı`

Proqnoz gələcək mərhələdə, kifayət qədər zaman sırası, əvvəlcədən müəyyən edilmiş proqnoz müddəti, mövsümi/sadə baza modelinə qarşı müqayisə, tarix üzrə ayrılmış test və xəta aralıqları ilə qiymətləndirilə bilər. Su sahəsi proqnozu üçün xəta hektarla verilməlidir. İki müşahidə hazır proqnoz funksiyası kimi təqdim edilmir.

Hazır GCOV HH/HV amplituda müqayisəsi deformasiya ölçüsü deyil. Sentinel-1 deformasiya emalı üçün uyğun SLC, faza əsaslı InSAR, orbit/DEM, koherensiya və müstəqil yoxlama lazımdır. Gələcək nəticələr də avtomatik tam 3D yerdəyişmə və ya bənd təhlükəsizliyi qərarı sayılmır.

Rəsmi texniki istinadlar: [ASF GCOV](https://nisar-docs.asf.alaska.edu/gcov/), [ASF GUNW](https://nisar-docs.asf.alaska.edu/gunw/), [Copernicus Sentinel-1 tətbiqləri və InSAR məhdudiyyətləri](https://sentiwiki.copernicus.eu/web/s1-applications).

## İstifadəçi və biznes faydası

İlkin istifadəçi: su resursları analitiki, ekoloq və uzaqdan zondlama mütəxəssisi. Qərar sahibi: aidiyyəti operator və ya qurum.

Yoxlanılacaq dəyər təklifi: parçalanmış məlumatları bir sübut paketinə toplamaq, ilkin araşdırma vaxtını azaltmaq və əlavə hansı məlumatın lazım olduğunu aydınlaşdırmaq. İnsanlara resursların əlçatanlığını təmin etmək daha böyük məqsəddir; hazır proqramın təkbaşına ölçülmüş nəticəsi kimi təqdim edilmir. Dəyişiklik antropogen təsirin sübutu sayılmır; buraxılış, su götürülməsi və səviyyə qeydləri ilə yoxlanılmalıdır.

## Təqdimatın nüvəsi

“Mingəçevir su anbarının iki radar müşahidəsində fərq gördük. SAR-BRIDGE bu fərqin harada və nə qədər olduğunu ölçür, mümkün izahların hansı sübutlara dayandığını göstərir və ekspertə növbəti yoxlamanı seçməkdə kömək edir.”

Demo: bütöv ərazi → radar müqayisəsi → dəyişiklik xəritəsi → 3-cü sektorun fərqli sübut statusu → müstəqil optik yoxlama və uyğunsuzluq → insanın əlavə sübut istəyi → rəyin hesabatla ixracı. İnsan baxışı hazırda lokal nümayiş kimi işləyir.

Challenge uyğunluğu, yoxlanılmış ölçülər, açıq məhdudiyyətlər və rahat demo yarışma təqdimatını gücləndirir; sıralama zəmanəti vermir.
