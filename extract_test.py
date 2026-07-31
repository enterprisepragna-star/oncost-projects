import fitz

doc = fitz.open('notebooks-diaries-notepads.pdf')
page = doc[0]
images = page.get_images(full=True)

print(f"Number of images on page 1: {len(images)}")
for img_index, img in enumerate(images[:5]):
    xref = img[0]
    base_image = doc.extract_image(xref)
    image_bytes = base_image["image"]
    image_ext = base_image["ext"]
    
    with open(f"page1_img{img_index}.{image_ext}", "wb") as f:
        f.write(image_bytes)
    print(f"Extracted image {img_index}: size {len(image_bytes)} bytes, ext {image_ext}")
