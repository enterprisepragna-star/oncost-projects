# ONCOST Product Upload Template

## How to use

1. Create a new Excel or Google Sheets file
2. Use the columns below (first row = headers exactly as shown)
3. Fill one product per row
4. Save as CSV or Excel (.xlsx)
5. Run the upload script (see bulk-upload.js)

## Column Headers (copy these exactly)

| Column | Required | Example | Notes |
|--------|----------|---------|-------|
| NAME | ✅ Yes | Brass Diya Set | Product display name |
| SKU | No | ONC-BR001 | Your internal code |
| CATEGORY | No | Brass Collection | Must match a category in admin |
| PRICE | ✅ Yes | 450 | In rupees, numbers only |
| SALE_PRICE | No | 399 | Leave blank if no offer |
| STOCK | No | 100 | Default: 0 |
| MOQ | No | 50 | Minimum order quantity |
| DESCRIPTION | No | Traditional brass diya for pooja | Short description |
| IMAGE_FILE | No | DMB02069 | Filename WITHOUT extension (script finds .jpg/.png automatically) |
| STATUS | No | Active | Active / Inactive / Draft |
| BADGE | No | Best Seller | Optional badge shown on card |
| BARCODE | No | 8901234567890 | EAN/UPC barcode |
| HSN_CODE | No | 7417 | For GST invoice |
| GST_PERCENT | No | 12 | 0 / 5 / 12 / 18 / 28 |
| IS_COMBO | No | No | Yes / No |
| COMBO_MOQ | No | 10 | Required if IS_COMBO = Yes |
| COMBO_LABEL | No | Set of 10 | e.g. "Kit of 5" |

## Example rows

| NAME | SKU | CATEGORY | PRICE | SALE_PRICE | STOCK | MOQ | DESCRIPTION | IMAGE_FILE | STATUS | BADGE |
|------|-----|----------|-------|------------|-------|-----|-------------|------------|--------|-------|
| Brass Diya Set | ONC-BR001 | Brass Collection | 450 | | 100 | 50 | Traditional brass diya for pooja and wedding return gifts | DMB02069 | Active | Best Seller |
| German Silver Bowl | ONC-GS001 | German Silver | 750 | 699 | 50 | 25 | Elegant German silver bowl for gifting | DMB02070 | Active | |
| Jute Gift Bag | ONC-JT001 | Jute Bags | 60 | | 200 | 100 | Eco-friendly jute bag for return gifts | DMB02071 | Active | New |

## Notes
- IMAGE_FILE: just the filename without extension. Script will look for DMB02069.jpg, DMB02069.JPG, DMB02069.png etc.
- If IMAGE_FILE is blank, product is created without an image (you can add it later from admin)
- CATEGORY: if a category doesn't exist, it will be created automatically
- SKU: if blank, auto-generated from product name
