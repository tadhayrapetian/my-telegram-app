import Foundation

/// Հավելվածի լեզուն։ Հիմնականը՝ հայերենը, երկրորդը՝ անգլերենը։
/// The app language. Primary is Armenian, secondary is English.
enum AppLanguage: String, CaseIterable, Identifiable {
    case hy // Հայերեն (առաջին լեզու / primary)
    case en // English (երկրորդ լեզու / secondary)

    var id: String { rawValue }

    /// Ինքնանվանում — ցուցադրվում է լեզվի ընտրիչում։
    var nativeName: String {
        switch self {
        case .hy: return "Հայերեն"
        case .en: return "English"
        }
    }

    var flag: String {
        switch self {
        case .hy: return "🇦🇲"
        case .en: return "🇬🇧"
        }
    }
}

/// Թարգմանությունների պահեստ։ Բոլոր տեքստերն ունեն հայերեն և անգլերեն տարբերակ։
/// A tiny localization store. Every string has an Armenian and an English variant.
struct L {
    let hy: String
    let en: String

    func callAsFunction(_ lang: AppLanguage) -> String {
        switch lang {
        case .hy: return hy
        case .en: return en
        }
    }
}

/// Հավելվածի բոլոր տողերը մեկ տեղում։
enum Strings {
    static let appTitle          = L(hy: "Instagram-ի հրապարակումների գեներատոր", en: "Instagram Post Generator")
    static let language          = L(hy: "Լեզու", en: "Language")

    // Բաժիններ / Sections
    static let content           = L(hy: "Բովանդակություն", en: "Content")
    static let style             = L(hy: "Ոճ", en: "Style")
    static let format            = L(hy: "Ձևաչափ", en: "Format")
    static let export            = L(hy: "Արտահանում", en: "Export")
    static let caption           = L(hy: "Ուղեկցող տեքստ (caption)", en: "Caption")
    static let hashtags          = L(hy: "Հեշթեգներ", en: "Hashtags")

    // Դաշտեր / Fields
    static let title             = L(hy: "Վերնագիր", en: "Title")
    static let subtitle          = L(hy: "Ենթավերնագիր", en: "Subtitle")
    static let titlePlaceholder  = L(hy: "Գրի՛ր գլխավոր տեքստը", en: "Type the headline")
    static let subtitlePlaceholder = L(hy: "Ավելացրու ենթավերնագիր", en: "Add a subtitle")
    static let captionPlaceholder  = L(hy: "Գրի՛ր հրապարակման նկարագրությունը…", en: "Write your post description…")

    static let theme             = L(hy: "Գունային թեմա", en: "Color theme")
    static let textColor         = L(hy: "Տեքստի գույն", en: "Text color")
    static let alignment         = L(hy: "Հավասարեցում", en: "Alignment")
    static let fontSize          = L(hy: "Տառաչափ", en: "Font size")
    static let alignLeading      = L(hy: "Ձախ", en: "Left")
    static let alignCenter       = L(hy: "Կենտրոն", en: "Center")
    static let alignTrailing     = L(hy: "Աջ", en: "Right")

    // Ձևաչափեր / Formats
    static let square            = L(hy: "Քառակուսի • 1080×1080", en: "Square • 1080×1080")
    static let portrait          = L(hy: "Ուղղահայաց • 1080×1350", en: "Portrait • 1080×1350")
    static let story             = L(hy: "Story • 1080×1920", en: "Story • 1080×1920")

    // Կոճակներ / Buttons
    static let exportPNG         = L(hy: "Պահպանել որպես PNG", en: "Save as PNG")
    static let copyCaption       = L(hy: "Պատճենել տեքստը", en: "Copy caption")
    static let copyHashtags      = L(hy: "Պատճենել հեշթեգները", en: "Copy hashtags")
    static let generateHashtags  = L(hy: "Առաջարկել հեշթեգներ", en: "Suggest hashtags")
    static let copied            = L(hy: "Պատճենվեց ✓", en: "Copied ✓")
    static let saved             = L(hy: "Պահպանվեց ✓", en: "Saved ✓")
    static let preview           = L(hy: "Նախադիտում", en: "Preview")

    // Հուշում / Hint
    static let exportHint        = L(hy: "Պատկերը կպահվի ամբողջական չափով՝ պատրաստ Instagram-ի համար։",
                                     en: "The image is saved at full resolution, ready for Instagram.")
}
