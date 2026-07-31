import PyPDF2
import re

try:
    with open('notebooks-diaries-notepads.pdf', 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        full_text = ""
        # read first 10 pages
        for i in range(min(10, len(reader.pages))):
            text = reader.pages[i].extract_text()
            if text:
                full_text += text + "\n"
        
        # print some lines to see structure
        print("First 20 lines of extracted text:")
        lines = full_text.split('\n')
        for line in lines[:20]:
            print(line.strip())
            
except Exception as e:
    print(f"Error: {e}")
