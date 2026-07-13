from PIL import Image

# Replace 'path_to_image' with your image's path
original_image_path = 'C:\Users\leand\OneDrive\TU Delft\CORE_HopsTutorial\Pictures\Alps.jpg'
img = Image.open(original_image_path)




width, height = img.size 

x=3

# Resize the image
img = img.resize((int(width/x), int(height/x)), Image.LANCZOS)

# If the image has an alpha channel, get rid of it
if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
    alpha = img.convert('RGBA').split()[-1]
    bg = Image.new("RGB", img.size, (255, 255, 255) + (255,))
    bg.paste(img, mask=alpha)
    img = bg

# Save the image with a new name
new_image_path = original_image_path.rsplit('.', 1)[0] + 'small.jpg'
img.save(new_image_path, 'JPEG')
