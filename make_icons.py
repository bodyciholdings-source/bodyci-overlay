import sys
import os

print("Starting icon generation script")

try:
    from PIL import Image
except ImportError as e:
    print(f"FAILED to import PIL: {e}")
    sys.exit(1)

source_path = 'extension/icons/bodyci-logo-source.png'

if not os.path.exists(source_path):
    print(f"ERROR: Source file not found at {source_path}")
    sys.exit(1)

source = Image.open(source_path).convert('RGBA')
print(f"Image loaded. Size: {source.size}")

# Remove background — more aggressive
pixels = list(source.getdata())
new_pixels = []
removed = 0
for p in pixels:
    r, g, b, a = p
    # Remove near-white pixels
    if r > 255 and g > 255 and b > 255:
        new_pixels.append((0, 0, 0, 0))
        removed += 1
    # Remove dark pixels (raised threshold to catch specks)
    elif r < 40 and g < 40 and b < 40:
        new_pixels.append((0, 0, 0, 0))
        removed += 1
    # Remove gray specks (slightly desaturated dark pixels)
    elif r < 60 and g < 60 and b < 60 and abs(r-g) < 10 and abs(g-b) < 10:
        new_pixels.append((0, 0, 0, 0))
        removed += 1
    else:
        new_pixels.append(p)
source.putdata(new_pixels)
print(f"Removed {removed} background pixels ({100*removed/len(pixels):.1f}%)")

bbox = source.getbbox()
cropped = source.crop(bbox)
print(f"Cropped to: {cropped.size}")

content_size = max(cropped.size)
padding_factor = .29  # sphere takes ~80% of canvas (1/1.25 = 0.8)
size = int(content_size * padding_factor)
square = Image.new('RGBA', (size, size), (0, 0, 0, 0))
offset = ((size - cropped.size[0]) // 2, (size - cropped.size[1]) // 2)
square.paste(cropped, offset)

square.save('extension/icons/bodyci-logo.png')
print("Saved bodyci-logo.png")

for s in [16, 48, 128]:
    resized = square.resize((s, s), Image.LANCZOS)
    resized.save(f'extension/icons/icon{s}.png')
    print(f"Saved extension/icons/icon{s}.png")

print("DONE!")