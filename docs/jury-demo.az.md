# Münsif demosu — 90 saniyə

Canlı tətbiq: https://sar-bridge-ai.onrender.com

Əsas cümlə: **“Radar dəyişiklik göstərir. SAR-BRIDGE həmin dəyişikliyin hansı sübuta dayandığını və insanın nəyi yoxlamalı olduğunu göstərir.”**

| Vaxt | Ekranda hərəkət | Deyiləcək fikir |
|---|---|---|
| 0–15 s | Giriş ekranı, Mingəçevir | “Su ehtiyatlarını izləyən mütəxəssis üçün iki tarix arasındakı fərqi anlamaq çətindir. Biz bir problemi seçdik: su ilə örtülü sahənin dəyişməsi.” |
| 15–30 s | Explore the change → Observe, müqayisə sürgüsü | “Bunlar NASA–ISRO NISAR-ın 25 iyun və 11 oktyabr 2026 radar müşahidələridir. Məlumat, tarix və ilkin məhsulların mənbələri açıqdır.” |
| 30–45 s | Compare | “Qaydalarımız 495,2 hektar radar göstəricili su itkisi işarələyir. Bu, təsdiqlənmiş su həcmi itkisi və ya bənd təhlükəsi deyil. Xəritədə hansı sahələri araşdıracağımızı görürük.” |
| 45–60 s | Explain, Sector 03 | “3-cü sektorda 34,3 hektar işarələnib. Qayda mühərriki su səviyyəsinin dəyişməsi hipotezini dəstəkləyir. Hansı sübutun dəstəklədiyini, nəyin çatışmadığını göstəririk. LLM ölçmə aparmır; hazır nəticəni izah edir.” |
| 60–75 s | Inspect validation | “Müstəqil optik müqayisə də var. Ümumi maska uyğunluğunu dəqiqlik saymırıq: dəyişiklik F1-i zəifdir, bunu göstəririk. Ona görə insan yoxlaması vacibdir.” |
| 75–90 s | Review queue → More evidence needed → Save review → Export review log | “Ekspert əlavə su səviyyəsi məlumatı istəyə bilər. Rəy və əsaslandırma məlumat versiyası ilə saxlanır. AI hökm vermir; yekun qərar insandadır.” |

Nümayişdə öz adınızı yazın və əsaslandırmanı “Demo review — optical overlap is limited; water-level records are needed.” kimi açıq işarələyin. Bu rəy brauzerdə saxlanır. Rəylərin JSON idxal/ixracı var; autentifikasiya və ortaq server bazası gələcək mərhələdir.

## Gələ biləcək suallar

- **Nəyi həll etdiniz?** NISAR dəyişiklik xəritəsini ölçü, mənbə, hipotez, müqayisə və insan yoxlaması ilə bir iş axınında birləşdirdik.
- **AI haradadır?** Qayda əsaslı sübut mühərriki və strukturlaşdırılmış nəticənin dil modeli ilə izahı. Hazır ölçmələr geoməkan pipeline-dan gəlir; neyron su detektoru və ya gələcəyi proqnozlaşdıran model iddia etmirik.
- **Niyə F1 aşağıdır?** Bu paketdə radar və optik dəyişikliklərin üst-üstə düşməsi zəifdir. Tarix, sahil zolaqları, qeydiyyat və qaydalar fərq yarada bilər; səbəbi təsdiqləmək üçün ayrıca yoxlama lazımdır. F1-in yüksək olduğunu iddia etmirik.
- **Xəzər üçün necə?** Növbəti pilotda kiçik sahil sahəsi və uyğun NISAR zaman sırası seçiləcək. Mövsümi baza və ayrıca validasiya olmadan Mingəçevir nəticəsini Xəzərə şamil etmirik.
- **Biznes faydası?** Analitikin ayrı mənbələri bir araya gətirməsini və növbəti yoxlamanı seçməsini asanlaşdırır. Vaxt qənaətini ekspertlərlə müqayisəli istifadə testində ölçmək planlaşdırılır.
- **Proqnoz və deformasiya?** Hazır MVP-də yoxdur. Bunun üçün ayrıca zaman sırası və uyğun faza əsaslı məhsullar, yoxlama və mütəxəssis nəzarəti lazımdır.

Səhnədən əvvəl: interneti və rasterlərin yüklənməsini yoxlayın, Present düyməsini sınayın, demo rəyinin lokal saxlandığını deyin. Canlı tətbiqdə yalnız göstərdiyiniz funksiyaları “hazırdır” adlandırın.
