# ONCOST Bulk Product Upload — Step by Step Guide

This guide helps you upload hundreds of products at once using an Excel file and your external hard drive of product images.

---

## What you need before starting

- [ ] Node.js installed on your PC → download from https://nodejs.org (LTS version)
- [ ] Your external hard drive with product images plugged in
- [ ] Your Supabase Service Role Key (one-time setup)
- [ ] An Excel or CSV file with product details (you create this)

---

## Part 1 — One-Time Setup

### Step 1: Get your Supabase Service Role Key

1. Go to https://supabase.com and log in
2. Open your ONCOST project
3. Click **Project Settings** (gear icon on left sidebar)
4. Click **API**
5. Under **Project API keys**, copy the **`service_role`** key (the long one — starts with `eyJ...`)
6. ⚠️ Keep this key private — never share it or commit it to GitHub

### Step 2: Save the key to your local environment file

1. Open File Explorer → go to `C:\Users\hp\Documents\ONCOST WEBSITE`
2. Create a new file called `.env.local` (if it doesn't exist)
3. Open it with Notepad and add these lines:

```
NEXT_PUBLIC_SUPABASE_URL=https://jyvmmypalshebqmnrdma.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...paste your full key here
```

4. Save and close the file

### Step 3: Install the upload tool

1. Open **Command Prompt** (press `Win + R`, type `cmd`, press Enter)
2. Run these commands one by one:

```
cd "C:\Users\hp\Documents\ONCOST WEBSITE\tools"
npm install
```

3. Wait for it to finish (takes 1–2 minutes)
4. You should see `added XX packages` — setup is done ✅

---

## Part 2 — Prepare Your Excel File

### Step 4: Create your product spreadsheet

Open Excel or Google Sheets. Create a new file with these column headers in **Row 1** (copy exactly):

```
NAME | SKU | CATEGORY | PRICE | SALE_PRICE | STOCK | MOQ | DESCRIPTION | IMAGE_FILE | STATUS | BADGE
```

### Step 5: Fill in your products — one row per product

| Column | What to put | Example |
|--------|-------------|---------|
| **NAME** ⭐ | Product display name | `Brass Diya Set` |
| **SKU** | Your product code | `ONC-BR001` |
| **CATEGORY** | Category name (must match admin) | `Brass Collection` |
| **PRICE** ⭐ | Price in rupees, numbers only | `450` |
| **SALE_PRICE** | Discounted price (leave blank if none) | `399` |
| **STOCK** | How many in stock | `100` |
| **MOQ** | Minimum order quantity | `50` |
| **DESCRIPTION** | Short product description | `Traditional brass diya for pooja` |
| **IMAGE_FILE** ⭐ | Image filename WITHOUT extension | `DMB02069` |
| **STATUS** | Active / Inactive / Draft | `Active` |
| **BADGE** | Optional badge on card | `Best Seller` |

⭐ = Required. Rest are optional.

### Step 6: About the IMAGE_FILE column

- Put just the filename **without extension**
- Example: if your image is `DMB02069.jpg` → put `DMB02069`
- The script will automatically find `.jpg`, `.JPG`, `.png`, `.webp` etc.
- If an image is not found, the product is still created — you can add the image later from admin

### Step 7: Save your Excel file

- Save as **Excel (.xlsx)** or **CSV (.csv)**
- Example: save to Desktop as `products.xlsx`

---

## Part 3 — Run the Upload

### Step 8: Plug in your hard drive

1. Plug in your external hard drive
2. Note the drive letter — e.g. `E:\` or `F:\`
3. Find the folder where your product images are stored
4. Note the full path — e.g. `E:\ProductImages` or `F:\Catalog Photos\Products`

### Step 9: Do a dry run first (safe — no changes made)

Open Command Prompt and run:

```
cd "C:\Users\hp\Documents\ONCOST WEBSITE\tools"

node bulk-upload.js --file "C:\Users\hp\Desktop\products.xlsx" --images "E:\ProductImages" --dry-run
```

Replace:
- `C:\Users\hp\Desktop\products.xlsx` → your actual Excel file path
- `E:\ProductImages` → your actual image folder path

The dry run will show you:
- How many products were found
- Which images were matched or missing
- What would be inserted — **without actually doing anything**

Review the output carefully before proceeding.

### Step 10: Run the actual upload

Once the dry run looks good, run without `--dry-run`:

```
node bulk-upload.js --file "C:\Users\hp\Desktop\products.xlsx" --images "E:\ProductImages"
```

The script will:
1. ✅ Create any missing categories automatically
2. ✅ Upload each matched image to Supabase Storage
3. ✅ Insert all products into the database in batches of 20
4. ✅ Print a summary when done

### Step 11: Verify in admin

1. Open https://www.oncost.shop/admin-dashboard.html
2. Go to **Products** section
3. You should see all your newly uploaded products
4. Review a few — check name, price, image, category are correct
5. Use **Edit** on any product to fix details if needed

---

## Part 4 — Troubleshooting

### "Cannot find module 'xlsx'"
Run `npm install` again inside the tools folder:
```
cd "C:\Users\hp\Documents\ONCOST WEBSITE\tools"
npm install
```

### "SUPABASE_URL not found"
Your `.env.local` file is missing or in the wrong folder.
Make sure it's at: `C:\Users\hp\Documents\ONCOST WEBSITE\.env.local`

### "Image not found: DMB02069"
- Check the image actually exists in your images folder
- Check the filename is exactly right (no typos)
- Try searching: `dir "E:\ProductImages\DMB02069*"` in Command Prompt

### "Storage upload failed: row-level security"
Your Supabase `product-images` bucket needs to allow uploads:
1. Go to Supabase Dashboard → Storage → Buckets
2. Click `product-images`
3. Click **Policies** → make sure there's an INSERT policy for `service_role`

### Products uploaded but images not showing
The image URLs are stored correctly but the bucket might not be public:
1. Go to Supabase Dashboard → Storage → Buckets → `product-images`
2. Click the three dots → **Make public**

---

## Part 5 — Tips for large catalogs

### Batch by category
Instead of uploading all products at once, do it category by category:
- Create `brass-products.xlsx` → upload
- Create `german-silver.xlsx` → upload
- Etc.

This makes it easier to review and fix mistakes.

### Use --skip-images first
If you're not sure about images, upload product data first and add images later:
```
node bulk-upload.js --file "C:\Users\hp\Desktop\products.xlsx" --skip-images
```
Then add images one by one from the admin Edit Product screen.

### Rerunning is safe
The script uses "upsert" — if a product with the same SKU already exists, it updates it instead of creating a duplicate. Safe to run multiple times.

---

## Quick Reference

| Task | Command |
|------|---------|
| Preview only (no changes) | `node bulk-upload.js --file products.xlsx --images E:\Images --dry-run` |
| Full upload with images | `node bulk-upload.js --file products.xlsx --images E:\Images` |
| Upload data only, no images | `node bulk-upload.js --file products.xlsx --skip-images` |

---

## Support

If something doesn't work, open Kiro and share:
1. The error message from Command Prompt
2. A screenshot of your Excel file headers
3. Your image folder path

We'll fix it together.
