import fitz

doc = fitz.open('notebooks-diaries-notepads.pdf')
print(f"Total pages: {len(doc)}")

for page_num in range(min(5, len(doc))):
    page = doc[page_num]
    text = page.get_text("text")
    print(f"--- Page {page_num+1} ---")
    print(text)
    
    images = page.get_images(full=True)
    print(f"Images on page {page_num+1}: {len(images)}")
