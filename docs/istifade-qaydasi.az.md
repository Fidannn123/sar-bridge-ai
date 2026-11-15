# SAR-BRIDGE — istifadə qaydası

Sayt: https://sar-bridge-ai.onrender.com

SAR-BRIDGE Mingəçevir su anbarında iki tarix arasında su ilə örtülü sahənin necə dəyişdiyini araşdırmaq üçündür. İstifadəçi harada dəyişiklik olduğunu, neçə hektarı əhatə etdiyini, mümkün izahları və hansı əlavə yoxlamanın lazım olduğunu görə bilir.

Hazırda sayt əvvəlcədən emal edilmiş məlumatlarla işləyir. İstifadəçi yeni peyk şəkli yükləyib canlı analiz başlatmır.

## İlk istifadə

1. **Explore the change** düyməsini basın.
2. **Observe** mərhələsində 25 iyun və 11 oktyabr 2026 tarixlərinin NISAR radar görüntülərini müqayisə edin. Xəritənin ortasındakı sürgünü sağa-sola çəkərək əvvəlki və sonrakı vəziyyətə baxın.
3. **Compare** mərhələsində rəngli dəyişiklik xəritəsini açın. Sistem hansı sahələri su itkisi və ya su artımı kimi işarələdiyini göstərir.
4. **Explain** mərhələsində 3-cü sektorun nəticəsini araşdırın: radar müşahidəsi, müstəqil optik müqayisə, mümkün izah və çatışmayan məlumatlar.
5. **Inspect validation** ilə radar və optik nəticələrin nə qədər uyğun gəldiyini yoxlayın.
6. **Review this sector** ilə öz rəyinizi və növbəti yoxlama addımını qeyd edin.

## Əsas bölmələr və düymələr

| Bölmə və ya düymə | Nə üçündür? |
|---|---|
| **Guided demo** | Layihəni addım-addım izah edir. İlk istifadə və münsif təqdimatı üçün uyğundur. |
| **Dashboard** | Ümumi göstəriciləri, sektor müqayisəsini, optik müqayisəni və lokal insan rəylərinin vəziyyətini göstərir. |
| **Workspace** | Xəritəni və bütün analiz vasitələrini sərbəst istifadə etməyə imkan verir. |
| **Review & validation** | İnsan rəylərini və müstəqil optik müqayisəni açır. Mobildə adı sadəcə **Review** görünə bilər. |
| **Method & data** | Məlumat mənbələrini, müşahidə tarixlərini, emal qaydalarını və məhdudiyyətləri göstərir. |
| **Export report** | Seçilmiş ərazinin ölçülərini, izahlarını, sübutlarını və həmin məlumat versiyasına aid lokal rəylərini Markdown hesabatı kimi endirir. |
| **Present** | Dəstəklənən brauzerdə təqdimatı tam ekran açır. |

## Dashboard: ümumi icmal

Birbaşa keçid: https://sar-bridge-ai.onrender.com/?view=dashboard

Dashboard ayrı icmal bölməsidir. Yuxarıdakı dörd göstərici bunlardır:

- **Radar-indicated loss:** bütün ərazi üzrə radarın işarələdiyi su örtüyü azalması.
- **Sectors with significant change:** mövcud emal qaydalarının əhəmiyyətli saydığı sektorlar; hazır paketdə 4/10.
- **Sectors with a recorded review:** hazır məlumat versiyasına aid ən azı bir lokal rəy yazılmış sektorlar. Eyni sektora bir neçə rəy yazılsa da, sektor bir dəfə sayılır. Bu, elmi təsdiq faizi deyil.
- **Valid radar coverage:** etibarlı radar məlumatı əhatəsi; dəqiqlik deyil.

**Sector comparison** cədvəli radar itkisi sahəsinə görə sıralanır. **Changed sectors only** yalnız əhəmiyyətli dəyişiklik olan sektorları saxlayır. **Engine results** isə etiketində göstərildiyi kimi bütün 10 sektor üzrə qalır. Cədvəl təhlükə reytinqi deyil.

Hər sətirdə **Map** həmin sektoru xəritədə açır, **Review** həmin sektor üçün rəy formasını açır. Mobil ekranda cədvəli yana sürüşdürərək statusları və düymələri görə bilərsiniz; sektor adı sabit qalır.

**Independent comparison** bütün ərazi üzrə optik müqayisəni göstərir. **Inspect full validation** dəqiq sayları, tarixləri və məhdudiyyətləri açır.

**Human review** sektorların son lokal rəy nəticələrini ayrıca sayır. Rəy saxlandıqda və ya idxal edildikdə icmal yenilənir. Lokal yaddaş oxunmursa, rəy əhatəsi **n/a** göstərilir; mövcud olmayan məlumat sıfır təsdiq kimi təqdim edilmir.

**Open map** bütün ərazinin xəritəsini açır. **Open review queue** bütün su anbarı üçün rəy pəncərəsini açır və oradan sektor seçmək olur. **Reservoir report** bütün ərazinin hesabatını endirir; bu düymə bütün sektorların rəylərini birləşdirən ixrac deyil. **Source and methods** metod və mənbələri açır.

## Workspace: xəritədən istifadə

| Vasitə | Nə üçündür? |
|---|---|
| **NISAR HH** | Bu layihədə su/quru fərqinin hesablanmasında istifadə olunan əsas radar görüntüsüdür. |
| **NISAR HV** | Əlavə radar polarizasiyasıdır. Hazır məlumat paketində su/quru ayrımı zəif olduğundan əsas ölçü kimi götürülmür. |
| **Sentinel-2** | Ərazini təbii rəngli optik görüntüdə göstərir; sahili və ətrafı anlamağı asanlaşdırır. |
| **Before / after comparison** | İki tarixi müqayisə etmək üçün sürgünü açıb-bağlayır. |
| **Radar-detected change** | Radarın hesabladığı dəyişiklik rənglərini açıb-bağlayır. |
| **Sector boundaries** | Analiz sektorlarının sərhədlərini açıb-bağlayır. |
| **Reservoir reference outline** | Su anbarının istinad konturunu açıb-bağlayır. |
| **+/− və xəritəni sürükləmək** | Yaxınlaşdırmaq, uzaqlaşdırmaq və ərazidə hərəkət etmək üçündür. |
| **Fit the whole reservoir** | Bütün su anbarını yenidən ekrana yerləşdirir. |

Örtük və sərhəd seçimləri **Layers** menyusundadır. Görüntü növü dəyişəndə ekrandakı tarixlər həmin sensoru izləyir. **Rəngli dəyişiklik örtüyü isə həmişə NISAR nəticəsidir.**

### Xəritədəki rənglər

| İşarə | Mənası |
|---|---|
| Narıncı/qəhvəyi — **Water loss** | Radarın su → quru keçidi kimi təsnif etdiyi sahə. |
| Mavi — **Water gain** | Radarın quru → su keçidi kimi təsnif etdiyi sahə. |
| Tünd sahə — **Radar-dark on both dates** | Hər iki tarixdə zəif radar siqnalı; təkbaşına suyun təsdiqi deyil. |
| **Insufficient data** | Nəticə çıxarmaq üçün məlumat çatışmır. |

## Sektorun araşdırılması

Sektor seçmək üçün aşağıdakı üsullardan birini istifadə edin:

- Xəritədə sektorun üzərinə klikləyin.
- **Water change by sector** qrafikində sektorun sütununa klikləyin.
- **Analysis area** siyahısından sektor seçin.

Seçilmiş sektorun ölçüləri və izahı **Evidence & interpretation** panelində açılır. **Whole reservoir** bütün analiz ərazisinin nəticəsini göstərir. Sektorun nəticəsi bütün ərazinin nəticəsindən fərqlənə bilər.

Qrafik su itkisini və artımını sektorlar üzrə müqayisə etmək üçündür. Xəritə seçimi, qrafik və analiz paneli birlikdə yenilənir. Seçilmiş sektorun keçidini brauzerin ünvan sətrindən paylaşmaq olar.

### Sübut mühərrikinin statusları

| Status | Necə başa düşülməlidir? |
|---|---|
| **Supported hypothesis** | Mövcud sübutlar mümkün izahı dəstəkləyir; səbəb qəti təsdiqlənməyib. |
| **Plausible but unconfirmed** | İzah mümkündür, əlavə sübut lazımdır. |
| **Insufficient evidence** | Nəticəyə gəlmək üçün sübut çatışmır. |
| **Not supported by available data** | Mövcud məlumatlar həmin izahı dəstəkləmir. |
| **No significant change detected** | Tətbiqin qaydalarına görə əhəmiyyətli dəyişiklik aşkarlanmayıb. |

Sübutlarda nəyin hipotezi dəstəklədiyinə, nəyin ziddiyyət yaratdığına və hansı məlumatın çatışmadığına baxın. Hipotezin dəstəklənməsi ekspert təsdiqi və ya fiziki səbəbin qəti sübutu deyil.

## Validation: nəticələrin müqayisəsi

**Review & validation → Validation** və ya **Inspect validation** ilə açılır. Seçilmiş ərazidə NISAR dəyişiklikləri müstəqil Sentinel-2 optik dəyişiklikləri ilə müqayisə edilir.

| Göstərici | Nəyi göstərir? |
|---|---|
| **Common-valid comparison area** | Hər iki radar və hər iki optik müşahidədə etibarlı məlumat olan müqayisə sahəsi. |
| **Excluded from comparison** | Ortaq etibarlı məlumat olmadığı üçün müqayisəyə daxil edilməyən sahə. |
| **After water-mask agreement** | Son müşahidədə radar və optik su/quru maskalarının uyğunluğu. |
| **Precision** | Radarın həmin dəyişiklik kimi işarələdiyi piksellərin nə qədərinin optik istinadda da göründüyü. |
| **Recall** | Optik istinadda görünən həmin dəyişiklik piksellərinin nə qədərinin radar tərəfindən işarələndiyi. |
| **F1** | Precision və recall göstəricilərini birləşdirən ölçü. |
| **IoU** | Radar və optik dəyişiklik sahələrinin kəsişməsinin onların birləşməsinə nisbəti. |

Su itkisi və su artımı üçün göstəricilər ayrıca verilir. Saylar cədvəlində **TP** üst-üstə düşən, **FP** yalnız radarın göstərdiyi, **FN** yalnız optik istinadın göstərdiyi, **TN** isə heç birinin həmin dəyişiklik sinfinə aid etmədiyi piksellərdir. Bunlar optik istinadla müqayisə saylarıdır; sahədə təsdiqlənmiş xəta sayları deyil.

**n/a** göstəricinin məxrəcinin sıfır olduğunu bildirir; mükəmməl nəticə demək deyil. **Export comparison JSON** müqayisə rəqəmlərini, tarixləri, metodu və məhdudiyyətləri fayl kimi endirir.

Optik müşahidə sahə həqiqəti deyil. Tarix, sensor, sahil zolağı və qeydiyyat fərqləri nəticəyə təsir edə bilər. İnsan rəyi də avtomatik olaraq sahə həqiqətinə çevrilmir.

## İnsan rəyinin yazılması

1. **Review & validation → Review queue** bölməsini açın.
2. Bütün su anbarını və ya sektoru seçin. Növbədə dəyişiklik olan sektorlar və radar itkisi sahəsi əsas götürülür; bu, təhlükə reytinqi deyil.
3. **Reviewer name** sahəsinə adınızı yazın. Ad ən azı 2 simvol olmalıdır.
4. **Review outcome** seçin.
5. **Rationale** sahəsində baxdığınız sübutları, qeyri-müəyyənliyi və rəyin səbəbini yazın. Əsaslandırma ən azı 20 simvol olmalıdır.
6. İstəyə görə **Evidence reference** sahəsinə HTTP/HTTPS keçidi və ya sənəd identifikatoru əlavə edin.
7. **Next action** seçin.
8. **Save review** düyməsini basın.

### Rəy nəticələri

| Seçim | Mənası |
|---|---|
| **Review completed** | Baxışın tamamlandığını qeyd edir; səbəbin qəti təsdiqi deyil. |
| **More evidence needed** | Əlavə sübut lazım olduğunu bildirir. |
| **Interpretation disputed** | Təqdim edilmiş izahla razılaşmadığınızı qeyd edir. |

### Növbəti addımlar

| Seçim | Məqsədi |
|---|---|
| **Request water-level records** | Su səviyyəsi qeydlərinin əldə edilməsini tövsiyə etmək. |
| **Request independent imagery** | Əlavə müstəqil görüntü ilə yoxlamanı tövsiyə etmək. |
| **Refer for field review** | Sahədə mütəxəssis baxışını tövsiyə etmək. |
| **Document observation** | Müşahidəni sənədləşdirmək. |

Bu seçimlər qeydə alınan tövsiyələrdir. Heç bir quruma və ya operatora avtomatik sorğu göndərilmir.

**Save review** yeni qeyd əlavə edir və onu məlumat paketinin versiyasına bağlayır. İnsan rəyi sübut mühərrikinin nəticəsini dəyişmir. **Review history** əvvəlki qeydləri göstərir. Köhnə məlumat versiyasına aid rəylər yeni versiyaya avtomatik tətbiq edilmir.

**Export review log** qeydləri JSON faylı kimi çıxarır. **Import log** həmin formatdakı qeydləri brauzerə gətirir. Eyni qeydin təkrar idxalı əlavə nüsxə yaratmır; ziddiyyətli və ya etibarsız qeydlər qəbul edilmir.

> Rəylər yalnız həmin brauzerdə lokal saxlanır. Adlar və sübut istinadları istifadəçinin bəyanıdır; kimlik təsdiqlənmir. Bu, autentifikasiyalı, çoxistifadəçili ekspert təsdiqi xidməti deyil. Brauzer məlumatlarını təmizləməzdən və ya başqa cihaza keçməzdən əvvəl qeydləri ixrac edin.

## Rəqəmləri düzgün anlamaq

Hazır məlumat paketi üzrə:

- NISAR müşahidələri **25 iyun → 11 oktyabr 2026** tarixlərinə aiddir; aralarında **108 gün** var.
- **495,2 ha** radarın işarələdiyi su örtüyü azalmasıdır. Bu, su həcmi və ya sahədə təsdiqlənmiş su itkisi deyil.
- **0,0 ha** radar üzrə aşkarlanmış su artımıdır; başqa sensorun artım göstərməsini istisna etmir.
- **99,99%** etibarlı radar məlumatı əhatəsidir; model dəqiqliyi deyil.
- **86,5%** son tarixdə su/quru maskalarının uyğunluğudur; dəyişiklik aşkarlama dəqiqliyi və ya AI inamı deyil.
- Su itkisi üzrə ümumi optik müqayisə **F1 ≈ 0,136**-dır. Bu zəif uyğunluq əlavə yoxlama tələb edir.
- **3-cü sektorda 34,3 ha** radar göstəricili su itkisi var. Həmin sektorun itkisi üzrə optik müqayisə **F1 ≈ 0,210**-dur.

## AI-nin rolu və tətbiqin sərhədləri

Geoməkan pipeline-ı radar məlumatını emal edir və sahəni hesablayır. Qayda əsaslı sübut mühərriki mümkün izahları qiymətləndirir. Dil modeli strukturlaşdırılmış nəticəni anlaşılan mətnə çevirir; özü peyk şəklindən hektar ölçmür. Uyğun izah alınmadıqda etiketlənmiş şablon mətn göstərilə bilər.

Hazır MVP iki tarix arasındakı su örtüyü dəyişikliyini araşdırır. Real vaxt monitorinqi, gələcək hadisələrin proqnozu, torpaq deformasiyasının ölçülməsi və bənd təhlükəsizliyinin sertifikatlaşdırılması funksiyaları yoxdur. Yekun fəaliyyət qərarı insan mütəxəssisə və aidiyyəti qərar sahibinə aiddir.

## Qısa nümayiş marşrutu

**Explore the change → Observe → Compare → Explain → Inspect validation → Review queue → More evidence needed → Save review → Export review log**

Təqdimat üçün əlavə sənəd: [90 saniyəlik münsif demo ssenarisi](jury-demo.az.md).
