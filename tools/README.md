# ONCOST Bulk Upload Tool

Upload hundreds of products at once from an Excel file + image folder.

---

## Setup (one time)

Make sure Node.js is installed on your PC. Then:

```
cd "C:\Users\hp\Documents\ONCOST WEBSITE\tools"
npm install
```

---

## Step 1 — Prepare your Excel file

See `PRODUCT_TEMPLATE.md` for the full column guide.

Minimum required columns:
- `NAME` — product name
- `PRICE` — price in rupees
- `IMAGE_FILE` — image filename WITHOUT extension (e.g. `DMB02069`)

Optional but recommended:
- `SKU`, `CATEGORY`, `DESCRIPTION`, `MOQ`, `STOCK`, `STATUS`, `BADGE`

Save as `.xlsx` or `.csv`.

---

## Step 2 — Connect your hard drive

Plug in your external hard drive. Note the drive path, e.g.:
- Windows: `E:\ProductImages` or `F:\Catalog Photos`

---

## Step 3 — Dry run first (safe preview)

```
node bulk-upload.js --file "C:\Users\hp\Desktop\products.xlsx" --images "E:\ProductImages" --dry-run
```

This shows you exactly what will be uploaded — no changes made.

---

## Step 4 — Run the actual upload

```
node bulk-upload.js --file "C:\Users\hp\Desktop\products.xlsx" --images "E:\ProductImages"
```

The script will:
1. Create any missing categories
2. Upload each image to Supabase Storage
3. Insert all products into the database

---

## Options

| Flag | Description |
|------|-------------|
| `--file` | Path to Excel or CSV file (required) |
| `--images` | Path to image folder on hard drive |
| `--dry-run` | Preview only, no changes |
| `--skip-images` | Upload product data only, skip images |

---

## Image naming

Your images are named like `DMB02069`. In your Excel, put `DMB02069` in the `IMAGE_FILE` column (no extension needed). The script will find `DMB02069.jpg`, `DMB02069.JPG`, `DMB02069.png` etc. automatically.

---

## Troubleshooting

**"SUPABASE_URL not found"**
Make sure `.env.local` exists in the parent folder with:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1Ni...
```
Get these from: Supabase Dashboard → Project Settings → API

**"Image not found: DMB02069"**
Check that the image exists in your images folder. The script searches one level of subdirectories too.

**"Storage upload failed"**
Make sure your Supabase `product-images` bucket exists and is public.
Go to: Supabase Dashboard → Storage → Buckets → product-images → Make public
