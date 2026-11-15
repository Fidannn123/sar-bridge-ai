# Münsif demosu — 90 saniyə

Canlı tətbiq: https://sar-bridge-ai.onrender.com

Əsas cümlə: **“Radar dəyişiklik göstərir. SAR-BRIDGE həmin dəyişikliyin hansı sübuta dayandığını və insanın nəyi yoxlamalı olduğunu göstərir.”**

| Vaxt | Ekranda hərəkət | Deyiləcək fikir |
|---|---|---|
| 0–10 s | Overview → Explore water atlas → Şəmkir → Open optical investigation | “9 hövzədə araşdırma var: Mingəçevirdə radar, digər 8 yerdə ayrıca Sentinel-2 optik analizi. Hər birində tarixli görüntü, su sahəsinin dəyişməsi və öz mənbələri göstərilir.” |
| 10–15 s | Mingachevir radar study | “Mütəxəssis üçün əsas sual: iki tarix arasında su ilə örtülü sahə harada dəyişib və bunu hansı sübutla izah edə bilərik?” |
| 15–30 s | Explore the change → Observe, müqayisə sürgüsü | “Bunlar NASA–ISRO NISAR-ın 25 iyun və 11 oktyabr 2026 radar müşahidələridir. Məlumat, tarix və ilkin məhsulların mənbələri açıqdır.” |
| 30–45 s | Compare | “Qaydalarımız 495,2 hektar radar göstəricili su itkisi işarələyir. Bu, təsdiqlənmiş su həcmi itkisi və ya bənd təhlükəsi deyil. Xəritədə hansı sahələri araşdıracağımızı görürük.” |
| 45–60 s | Explain, Sector 03 | “3-cü sektorda 34,3 hektar işarələnib. Qayda mühərriki su səviyyəsinin dəyişməsi hipotezini dəstəkləyir. Hansı sübutun dəstəklədiyini, nəyin çatışmadığını göstəririk. LLM ölçmə aparmır; hazır nəticəni izah edir.” |
| 60–75 s | Inspect validation → Sensor comparison | “Müstəqil optik müqayisə də var. Örtük məlumatın yararlılığını, maska uyğunluğu bir tarixdə su/quru təsnifatını, F1 isə dəyişiklik yerlərinin uyğunluğunu ölçür. Bu paketdə dəyişiklik F1-i aşağıdır; ona görə əlavə yoxlama lazımdır.” |
| 75–90 s | Review queue → More evidence needed → Save review → Export review log | “Ekspert əlavə su səviyyəsi məlumatı istəyə bilər. Rəy və əsaslandırma məlumat versiyası ilə saxlanır. AI hökm vermir; yekun qərar insandadır.” |

Nümayişdə öz adınızı yazın və əsaslandırmanı “Demo review — optical overlap is limited; water-level records are needed.” kimi açıq işarələyin. Bu rəy brauzerdə saxlanır. Rəylərin JSON idxal/ixracı var; autentifikasiya və ortaq server bazası gələcək mərhələdir.

## Gələ biləcək suallar

- **Nəyi həll etdiniz?** NISAR dəyişiklik xəritəsini ölçü, mənbə, hipotez, müqayisə və insan yoxlaması ilə bir iş axınında birləşdirdik.
- **AI haradadır?** Qayda əsaslı sübut mühərriki və strukturlaşdırılmış nəticənin dil modeli ilə izahı. Hazır ölçmələr geoməkan pipeline-dan gəlir; neyron su detektoru və ya gələcəyi proqnozlaşdıran model iddia etmirik.
- **Niyə F1 aşağıdır?** Bu paketdə radar və optik dəyişikliklərin üst-üstə düşməsi zəifdir. Tarix, sahil zolaqları, qeydiyyat və qaydalar fərq yarada bilər; səbəbi təsdiqləmək üçün ayrıca yoxlama lazımdır. F1-in yüksək olduğunu iddia etmirik.
- **Xəzər üçün necə?** Növbəti pilotda kiçik sahil sahəsi və uyğun NISAR zaman sırası seçiləcək. Mövsümi baza və ayrıca validasiya olmadan Mingəçevir nəticəsini Xəzərə şamil etmirik.
- **Başqa hövzələr artıq analiz olunur?** Bəli: Şəmkir, Araz, Sevan, Enguri, Mead, Powell, Nasser və Atatürk üçün ayrıca Sentinel-2 optik analizi hazırlanıb. Əvvəl/sonra müqayisəsi, itki/artım, 10 sektor, mənbələr və hesabat ixracı işləyir. Bunlar Mingəçevirin NISAR nəticələri deyil; hər hövzənin öz məlumatı var. Sərbəst koordinat seçimi isə hələ yalnız xəritə önbaxışıdır.
- **Sector 6-da 1 ha itki varsa, niyə dəyişiklik yoxdur yazılır?** “Əhəmiyyətli dəyişiklik yoxdur” deməkdir: ölçülən 1 ha fərq mühərrikin 10 ha həddindən aşağıdır. Ölçmə saxlanır, amma bu kiçik fərqə ekoloji səbəb təyin edilmir.
- **Biznes faydası?** Analitikin ayrı mənbələri bir araya gətirməsini və növbəti yoxlamanı seçməsini asanlaşdırır. Vaxt qənaətini ekspertlərlə müqayisəli istifadə testində ölçmək planlaşdırılır.
- **Proqnoz və deformasiya?** Hazır MVP-də yoxdur. Bunun üçün ayrıca zaman sırası və uyğun faza əsaslı məhsullar, yoxlama və mütəxəssis nəzarəti lazımdır.

Səhnədən əvvəl: interneti və rasterlərin yüklənməsini yoxlayın, Present düyməsini sınayın, demo rəyinin lokal saxlandığını deyin. Canlı tətbiqdə yalnız göstərdiyiniz funksiyaları “hazırdır” adlandırın.
