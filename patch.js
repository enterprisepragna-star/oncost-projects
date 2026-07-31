const fs = require('fs');
let code = fs.readFileSync('catalog-notebook.js', 'utf8');

const imageUploadHandler = `
  const imageUpload = document.getElementById('image-upload');
  let currentImageCard = null;

  if (imageUpload) {
    imageUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0 && currentImageCard) {
        const file = e.target.files[0];
        const code = currentImageCard.querySelector('.product-code').textContent.trim();
        const imgNode = currentImageCard.querySelector('.card-image img');
        
        try {
          // Show loading state
          const originalSrc = imgNode.src;
          imgNode.style.opacity = '0.5';
          
          // 1. Upload to Supabase Storage
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
          const path = \`catalog/\${Date.now()}-\${Math.random().toString(36).substring(2, 8)}.\${ext}\`;
          
          const { error: uploadError } = await window.supabaseClient.storage
            .from('product-images')
            .upload(path, file, {
              cacheControl: '31536000',
              upsert: false,
              contentType: file.type,
            });
            
          if (uploadError) throw uploadError;
          
          // 2. Get Public URL
          const { data: { publicUrl } } = window.supabaseClient.storage
            .from('product-images')
            .getPublicUrl(path);
            
          // 3. Update Database
          const { error: dbError } = await window.supabaseClient
            .from('catalog')
            .update({ image_url: publicUrl })
            .eq('id', code);
            
          if (dbError) throw dbError;
          
          // Success: Update UI
          imgNode.src = publicUrl;
          imgNode.style.opacity = '1';
          alert('Image uploaded and saved successfully!');
          
        } catch (error) {
          console.error('Error uploading image:', error);
          alert('Failed to upload image: ' + error.message);
          imgNode.style.opacity = '1';
        }

        e.target.value = '';
        currentImageCard = null;
      }
    });
  }
`;

const actionButtonsHandler = `
  productList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const card = btn.closest('.product-card');
    if (!card) return;

    const code = card.querySelector('.product-code').textContent.trim();
    const actionText = btn.textContent.trim();

    if (actionText === 'Edit Price' || btn.querySelector('.fa-pen')) {
      const priceValNode = card.querySelector('.price-val');
      const currentPrice = priceValNode.textContent.trim();
      const newPrice = prompt('Enter new price:', currentPrice);
      
      if (newPrice !== null && newPrice.trim() !== '' && !isNaN(newPrice)) {
        try {
          const originalText = btn.innerHTML;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
          btn.disabled = true;
          
          const { error } = await window.supabaseClient
            .from('catalog')
            .update({ price: parseFloat(newPrice) })
            .eq('id', code);
            
          if (error) throw error;
          
          priceValNode.textContent = newPrice;
        } catch (err) {
          alert('Failed to update price: ' + err.message);
        } finally {
          btn.innerHTML = '<i class="fas fa-pen"></i> Edit Price';
          btn.disabled = false;
        }
      }
    } 
    else if (actionText === 'Edit Details' || btn.querySelector('.fa-file-alt')) {
      const descNode = card.querySelector('.product-desc');
      const currentDesc = descNode.textContent.trim();
      const newDesc = prompt('Enter new details:', currentDesc);
      
      if (newDesc !== null) {
        try {
          const originalText = btn.innerHTML;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
          btn.disabled = true;
          
          const { error } = await window.supabaseClient
            .from('catalog')
            .update({ description: newDesc })
            .eq('id', code);
            
          if (error) throw error;
          
          descNode.textContent = newDesc;
        } catch (err) {
          alert('Failed to update details: ' + err.message);
        } finally {
          btn.innerHTML = '<i class="fas fa-file-alt"></i> Edit Details';
          btn.disabled = false;
        }
      }
    }
    else if (actionText === 'Upload Image' || btn.querySelector('.fa-upload')) {
      currentImageCard = card;
      if (imageUpload) imageUpload.click();
    }
    else if (btn.classList.contains('btn-icon') || btn.querySelector('.fa-eye')) {
      alert(\`Viewing product \${code} on storefront...\`);
    }
  });
`;

code = code.replace(/const imageUpload = document\.getElementById\('image-upload'\);[\s\S]*?(?=productList\?\.addEventListener)/, imageUploadHandler);
code = code.replace(/productList\?\.addEventListener\('click', \(e\) => \{[\s\S]*?\}\);/, actionButtonsHandler);

fs.writeFileSync('catalog-notebook.js', code);
