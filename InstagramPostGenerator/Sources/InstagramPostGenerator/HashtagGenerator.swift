import Foundation

/// Պարզ հեշթեգ-առաջարկիչ՝ վերնագրի և տեքստի բառերի հիման վրա։
/// A simple hashtag suggester based on words from the title and caption.
enum HashtagGenerator {

    /// Հանրաճանաչ ընդհանուր հեշթեգներ (հայերեն + անգլերեն)։
    private static let popular = [
        "#instagram", "#instagood", "#photooftheday", "#reels",
        "#հայաստան", "#երևան", "#armenia", "#yerevan",
        "#viral", "#trending", "#follow", "#love"
    ]

    /// Ստեղծում է հեշթեգների տող՝ ելնելով տրված տեքստից։
    /// Builds a hashtag string from the given text.
    static func suggest(from text: String, count: Int = 12) -> String {
        // Բառերի մաքրում և վերածում հեշթեգների։
        let words = text
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 3 }

        var tags: [String] = []
        var seen = Set<String>()

        for word in words {
            let tag = "#" + word
            if seen.insert(tag).inserted {
                tags.append(tag)
            }
            if tags.count >= count / 2 { break }
        }

        for tag in popular {
            if tags.count >= count { break }
            if seen.insert(tag).inserted {
                tags.append(tag)
            }
        }

        return tags.joined(separator: " ")
    }
}
