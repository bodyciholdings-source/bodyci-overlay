import sys
import os

print("=" * 50)
print("Starting icon generation script")
print("=" * 50)
print(f"Working directory: {os.getcwd()}")
print(f"Python version: {sys.version}")

try:
    from PIL import Image
    print(f"PIL/Pillow imported successfully")
except ImportError as e:
    print(f"FAILED to import PIL: {e}")
    sys.exit(1)

source_path = 'extension/icons/bodyci-logo-source.png'

if not os.path.exists(source_path):
    print(f"ERROR: Source file not found at {source_path}")
    print("Files in extension/icons/:")
    for f in os.listdir('extension/icons'):
        print(f"  - {f}")
    sys.exit(1)

print(f"Source file found: {source_path}")
file_size = os.path.getsize(source_path)
print(f"Source file size: {file_size} bytes")

source = Image.open(source_path).convert('RGBA')
print(f"Image loaded. Size: {source.size}, Mode: {source.mode}")

# Sample some pixels to see what we're dealing with
print("Sampling pixels...")
print(f"  Top-left corner: {source.getpixel((0, 0))}")
print(f"  Center: {source.getpixel((source.size[0]//2, source.size[1]//2))}")
print(f"  Top-middle: {source.getpixel((source.size[0]//2, 5))}")

# Remove background (handles both white and black)
pixels = list(source.getdata())
print(f"Processing {len(pixels)} pixels...")
new_pixels = []
removed = 0
for p in pixels:
    r, g, b, a = p
    if r > 240 and g > 240 and b > 240:
        new_pixels.append((0, 0, 0, 0))
        removed += 1
    elif r < 15 and g < 15 and b < 15:
        new_pixels.append((0, 0, 0, 0))
        removed += 1
    else:
        new_pixels.append(p)
source.putdata(new_pixels)
print(f"Removed {removed} background pixels ({100*removed/len(pixels):.1f}%)")

bbox = source.getbbox()
print(f"Bounding box of content: {bbox}")
cropped = source.crop(bbox)
print(f"Cropped to: {cropped.size}")

size = max(cropped.size)
square = Image.new('RGBA', (size, size), (0, 0, 0, 0))
offset = ((size - cropped.size[0]) // 2, (size - cropped.size[1]) // 2)
square.paste(cropped, offset)
print(f"Square canvas: {square.size}")

square.save('extension/icons/bodyci-logo.png')
print("Saved bodyci-logo.png")

for s in [16, 48, 128]:
    resized = square.resize((s, s), Image.LANCZOS)
    output_path = f'extension/icons/icon{s}.png'
    resized.save(output_path)
    print(f"Saved {output_path}")

print("=" * 50)
print("DONE!")
print("=" * 50)