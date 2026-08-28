from PIL import Image

src = r"D:\Jovan's Workplace\app\assets\icon.png"
dst = r"D:\Jovan's Workplace\app\assets\icon.ico"

im = Image.open(src).convert("RGBA")
w, h = im.size

# Build a 256x256 transparent canvas, center the logo preserving aspect ratio.
base = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
target_w = 232
target_h = int(h * target_w / w)
scaled = im.resize((target_w, target_h), Image.LANCZOS)
base.paste(scaled, ((256 - target_w) // 2, (256 - target_h) // 2), scaled)

base.save(dst, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print("ico written:", dst, "base size:", base.size)
