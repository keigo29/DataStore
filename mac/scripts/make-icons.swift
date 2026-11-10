// アイコンを作る（Mac 版・PWA・iPhone すべて同じデザイン）
//   swift mac/scripts/make-icons.swift      ← リポジトリのいちばん上で実行
// デザイン：
//   ・背景：控えめな青灰色。くすんだ水色 → 青灰 → 紺のななめのグラデーション
//   ・左上の光：画面のカードと同じ --gloss（radial-gradient at 23% 0%）
//   ・3本の線：ノートの行。2本目を少し薄くして奥行きを出す
//   ・ひし形：今日・節目のしるし。やわらかい黄土色
import AppKit
import CoreGraphics

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
func col(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: cs, components: [CGFloat((hex >> 16) & 255) / 255, CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, a])!
}

enum Mode { case mac, full, maskable }

func render(_ mode: Mode, size: Int, to out: String) {
    let S = CGFloat(size)
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.translateBy(x: 0, y: S); ctx.scaleBy(x: 1, y: -1)   // 左上が原点
    ctx.interpolationQuality = .high

    // 背景の四角（Mac は Apple のテンプレート：1024 に対して 824 の角丸、まわりは余白と影）
    let tile: CGRect = mode == .mac ? CGRect(x: S * 100 / 1024, y: S * 100 / 1024, width: S * 824 / 1024, height: S * 824 / 1024)
                                     : CGRect(x: 0, y: 0, width: S, height: S)
    let shape: CGPath = mode == .mac ? CGPath(roundedRect: tile, cornerWidth: tile.width * 0.225, cornerHeight: tile.width * 0.225, transform: nil)
                                      : CGPath(rect: tile, transform: nil)
    let u = tile.width / 512   // 絵は 512 のマス目で描く
    // 中身の大きさ：maskable は丸く切られても欠けないよう 80% の中に入れる
    let g: CGFloat = mode == .maskable ? 0.8 : 1
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: tile.minX + (256 + (x - 256) * g) * u, y: tile.minY + (256 + (y - 256) * g) * u)
    }

    if mode == .mac {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -S * 10 / 1024), blur: S * 24 / 1024, color: col(0x0a1440, 0.30))
        ctx.addPath(shape); ctx.setFillColor(col(0x4a5f82)); ctx.fillPath()
        ctx.restoreGState()
    }

    ctx.saveGState()
    ctx.addPath(shape); ctx.clip()

    // 背景のグラデーション
    let bg = CGGradient(colorsSpace: cs, colors: [col(0x8fa9c6), col(0x5b779c), col(0x3e4c6e)] as CFArray, locations: [0, 0.5, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: tile.minX, y: tile.minY), end: CGPoint(x: tile.maxX, y: tile.maxY),
                           options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    // 左上の光（--gloss と同じ形）
    let gl = CGGradient(colorsSpace: cs, colors: [col(0xffffff, 0.20), col(0xffffff, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(gl, startCenter: CGPoint(x: tile.minX + tile.width * 0.23, y: tile.minY), startRadius: 0,
                           endCenter: CGPoint(x: tile.minX + tile.width * 0.23, y: tile.minY), endRadius: tile.width * 1.0, options: [])
    // 下のほうを少し沈める
    let dk = CGGradient(colorsSpace: cs, colors: [col(0x000000, 0), col(0x000000, 0.14)] as CFArray, locations: [0.55, 1])!
    ctx.drawLinearGradient(dk, start: CGPoint(x: tile.midX, y: tile.minY), end: CGPoint(x: tile.midX, y: tile.maxY), options: [])

    // 線とひし形（影でうすく浮かせる）
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6 * u * g), blur: 16 * u * g, color: col(0x0a1450, 0.22))
    ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    func pill(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ c: CGColor) {
        let a = p(x0, y0), b = p(x1, y1)
        let r = CGRect(x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y)
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: r.height / 2, cornerHeight: r.height / 2, transform: nil))
        ctx.setFillColor(c); ctx.fillPath()
    }
    // 元のアイコンと同じ位置・長さ（ずらした3行）。太さは 48
    pill(116, 150, 316, 198, col(0xffffff))
    pill(186, 232, 396, 280, col(0xffffff, 0.62))
    pill(146, 314, 296, 362, col(0xffffff))

    // ひし形：角を少し丸めて、オレンジのグラデーション
    let c = p(366, 338), h = 34 * u * g, rr = 7 * u * g
    let dia = CGMutablePath()
    let pts = [CGPoint(x: c.x, y: c.y - h), CGPoint(x: c.x + h, y: c.y), CGPoint(x: c.x, y: c.y + h), CGPoint(x: c.x - h, y: c.y)]
    dia.move(to: CGPoint(x: (pts[3].x + pts[0].x) / 2, y: (pts[3].y + pts[0].y) / 2))
    for i in 0..<4 { dia.addArc(tangent1End: pts[i], tangent2End: pts[(i + 1) % 4], radius: rr) }
    dia.closeSubpath()
    ctx.addPath(dia); ctx.setFillColor(col(0xe0a96a)); ctx.fillPath()
    ctx.endTransparencyLayer()
    ctx.restoreGState()
    // ひし形の中の明るさ（上を明るく）
    ctx.saveGState()
    ctx.addPath(dia); ctx.clip()
    let dg = CGGradient(colorsSpace: cs, colors: [col(0xf2c98a), col(0xd49355)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(dg, start: CGPoint(x: c.x, y: c.y - h), end: CGPoint(x: c.x, y: c.y + h), options: [])
    ctx.restoreGState()

    // ふちの光（Mac のみ。暗い Dock でも形がわかるように）
    if mode == .mac {
        ctx.addPath(shape)
        ctx.setStrokeColor(col(0xffffff, 0.16)); ctx.setLineWidth(S * 3 / 1024); ctx.strokePath()
    }
    ctx.restoreGState()

    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
    print("作りました：", out, "\(size)px")
}

let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath
render(.mac, size: 1024, to: root + "/mac/build/icon.png")
render(.full, size: 512, to: root + "/app/icons/icon-512.png")
render(.full, size: 192, to: root + "/app/icons/icon-192.png")
render(.full, size: 180, to: root + "/app/icons/apple-touch-icon.png")
render(.maskable, size: 512, to: root + "/app/icons/icon-maskable-512.png")
