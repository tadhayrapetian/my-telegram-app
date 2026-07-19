import SwiftUI

/// Instagram-ի հրապարակման ձևաչափերը՝ պաշտոնական չափերով։
/// Instagram post formats with their official pixel sizes.
enum PostFormat: String, CaseIterable, Identifiable {
    case square
    case portrait
    case story

    var id: String { rawValue }

    /// Իրական չափը պիքսելներով (արտահանման համար)։
    var pixelSize: CGSize {
        switch self {
        case .square:   return CGSize(width: 1080, height: 1080)
        case .portrait: return CGSize(width: 1080, height: 1350)
        case .story:    return CGSize(width: 1080, height: 1920)
        }
    }

    var label: L {
        switch self {
        case .square:   return Strings.square
        case .portrait: return Strings.portrait
        case .story:    return Strings.story
        }
    }
}

/// Պատրաստի գունային թեմաներ (գրադիենտներ)։
/// Ready-made color themes (gradients).
struct Theme: Identifiable, Hashable {
    let id: String
    let name: L
    let colors: [Color]

    static let all: [Theme] = [
        Theme(id: "ararat",   name: L(hy: "Արարատ", en: "Ararat"),
              colors: [Color(hex: 0x2C3E50), Color(hex: 0x4CA1AF)]),
        Theme(id: "sunset",   name: L(hy: "Մայրամուտ", en: "Sunset"),
              colors: [Color(hex: 0xFF512F), Color(hex: 0xF09819)]),
        Theme(id: "grape",    name: L(hy: "Խաղող", en: "Grape"),
              colors: [Color(hex: 0x8E2DE2), Color(hex: 0x4A00E0)]),
        Theme(id: "mint",     name: L(hy: "Անանուխ", en: "Mint"),
              colors: [Color(hex: 0x11998E), Color(hex: 0x38EF7D)]),
        Theme(id: "rose",     name: L(hy: "Վարդ", en: "Rose"),
              colors: [Color(hex: 0xEC008C), Color(hex: 0xFC6767)]),
        Theme(id: "night",    name: L(hy: "Գիշեր", en: "Night"),
              colors: [Color(hex: 0x0F2027), Color(hex: 0x2C5364)]),
        Theme(id: "gold",     name: L(hy: "Ոսկի", en: "Gold"),
              colors: [Color(hex: 0xF7971E), Color(hex: 0xFFD200)]),
        Theme(id: "ocean",    name: L(hy: "Ծով", en: "Ocean"),
              colors: [Color(hex: 0x2193B0), Color(hex: 0x6DD5ED)])
    ]
}

enum TextAlignmentOption: String, CaseIterable, Identifiable {
    case leading, center, trailing
    var id: String { rawValue }

    var swiftUIAlignment: TextAlignment {
        switch self {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    var frameAlignment: Alignment {
        switch self {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    var label: L {
        switch self {
        case .leading:  return Strings.alignLeading
        case .center:   return Strings.alignCenter
        case .trailing: return Strings.alignTrailing
        }
    }
}

/// Հավելվածի ողջ վիճակը՝ մեկ դիտարկելի օբյեկտ։
/// The whole app state in a single observable object.
final class PostModel: ObservableObject {
    // Լեզու / Language — հիմնականը հայերենն է։
    @Published var language: AppLanguage = .hy

    // Բովանդակություն / Content
    @Published var title: String = "Բարի գալուստ"
    @Published var subtitle: String = "Ստեղծիր քո առաջին հրապարակումը"
    @Published var caption: String = ""
    @Published var hashtags: String = ""

    // Ոճ / Style
    @Published var theme: Theme = Theme.all[0]
    @Published var textColor: Color = .white
    @Published var alignment: TextAlignmentOption = .leading
    @Published var titleFontSize: Double = 88

    // Ձևաչափ / Format
    @Published var format: PostFormat = .square

    /// Ենթավերնագրի չափը կապված է վերնագրի չափին։
    var subtitleFontSize: Double { titleFontSize * 0.45 }
}
