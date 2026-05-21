from PIL import Image

im = Image.open('extension/icons/heart-input.png').convert('RGBA')
pixels = im.getdata()
new_pixels = []
for p in pixels:
    # If pixel is very dark (near-black background), make it transparent
    if p[0] < 30 and p[1] < 30 and p[2] < 30:
        new_pixels.append((0, 0, 0, 0))
    else:
        new_pixels.append(p)
im.putdata(new_pixels)
im.save('extension/icons/heart.png')
print("Done! Saved to extension/icons/heart.png")