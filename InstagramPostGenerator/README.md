# Instagram-ի հրապարակումների գեներատոր / Instagram Post Generator

macOS-ի համար նախատեսված նատիվ հավելված (SwiftUI)՝ Instagram-ի հրապարակումների
համար պատկերներ ստեղծելու համար։ Հիմնական լեզուն **հայերենն** է, երկրորդ լեզուն՝
**անգլերենը** (փոխարկվում է վերևի ընտրիչով)։

A native macOS app (SwiftUI) for creating Instagram post images. The primary
language is **Armenian**, the secondary language is **English** (switch with the
toggle at the top).

---

## Հնարավորությունները / Features

- 🖼️ Երեք ձևաչափ / Three formats — Square (1080×1080), Portrait (1080×1350), Story (1080×1920)
- 🎨 8 պատրաստի գունային թեմա (գրադիենտներ) / 8 ready-made gradient themes
- ✍️ Վերնագիր, ենթավերնագիր, տառաչափ, հավասարեցում, տեքստի գույն / Title, subtitle, font size, alignment, text color
- 👀 Կենդանի նախադիտում / Live preview
- 💾 Արտահանում որպես PNG՝ ամբողջական չափով / Export to full-resolution PNG
- #️⃣ Հեշթեգների ավտոմատ առաջարկ / Automatic hashtag suggestions
- 📋 Caption-ի և հեշթեգների պատճենում / Copy caption & hashtags

---

## Պահանջները / Requirements

- **macOS 13 Ventura** կամ ավելի նոր / or newer
- **Xcode 15+** կամ Swift toolchain (`swift --version` ≥ 5.9)

---

## Գործարկումը / Running

### Տերմինալով / From the terminal

```bash
cd InstagramPostGenerator
swift run
```

### Xcode-ով / With Xcode

```bash
cd InstagramPostGenerator
open Package.swift      # բացում է նախագիծը Xcode-ում / opens the project in Xcode
```

Ապա սեղմիր **Run** (⌘R)։ / Then press **Run** (⌘R).

---

## Ինչպես օգտագործել / How to use

1. Ընտրի՛ր լեզուն վերևից (հայերեն / English)։ / Pick the language at the top.
2. Լրացրո՛ւ վերնագիրը և ենթավերնագիրը։ / Fill in the title and subtitle.
3. Ընտրի՛ր գունային թեմա և ձևաչափ։ / Choose a color theme and a format.
4. Կարգավորի՛ր տառաչափն ու հավասարեցումը։ / Adjust font size and alignment.
5. Սեղմի՛ր **«Պահպանել որպես PNG»**՝ պատկերը պահելու համար։ / Click **“Save as PNG”**.
6. Ցանկության դեպքում՝ առաջարկի՛ր հեշթեգներ և պատճենի՛ր caption-ը։ / Optionally suggest hashtags and copy the caption.

---

## Կառուցվածքը / Project structure

```
InstagramPostGenerator/
├── Package.swift
└── Sources/InstagramPostGenerator/
    ├── InstagramPostGeneratorApp.swift  # Մուտքի կետ / App entry point
    ├── ContentView.swift                # Հիմնական միջերես / Main UI
    ├── PostModel.swift                  # Վիճակ և մոդել / State & model
    ├── PostCanvasView.swift             # Պատկերի նկարում / Post rendering
    ├── Exporter.swift                   # PNG արտահանում / PNG export
    ├── HashtagGenerator.swift           # Հեշթեգներ / Hashtags
    ├── Localization.swift               # Թարգմանություններ / Translations
    └── Color+Hex.swift                  # Գունային օգնական / Color helper
```
