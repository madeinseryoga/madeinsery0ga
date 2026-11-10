import os
import zipfile
import shutil

PROJECT_DIR = r"C:\флешка\03_Сайт\ChinesePlatform_Project"
OUT_DIR = r"C:\флешка\03_Сайт"
FLASH_ROOT = r"C:\флешка"

def make_zip(zip_path, include_shards=False):
    print(f"Creating {os.path.basename(zip_path)} (include_shards={include_shards})...")
    
    # Files to include at root
    root_files = [
        "index.html",
        "app.html",
        "manifest.json",
        "icon.png"
    ]
    
    # Folders to include
    include_folders = [
        "icons",
        "images"
    ]
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # Add root files
        for rf in root_files:
            fp = os.path.join(PROJECT_DIR, rf)
            if os.path.exists(fp):
                zf.write(fp, rf)
                print(f"  + {rf}")
            else:
                print(f"  ! MISSING: {rf}")
                
        # Add icons and images folders
        for folder in include_folders:
            fpath = os.path.join(PROJECT_DIR, folder)
            if os.path.exists(fpath):
                for root, _, files in os.walk(fpath):
                    for file in files:
                        full_p = os.path.join(root, file)
                        rel_p = os.path.relpath(full_p, PROJECT_DIR)
                        zf.write(full_p, rel_p)
                print(f"  + folder {folder}/")

        # Add data folder selectively
        data_dir = os.path.join(PROJECT_DIR, "data")
        for root, dirs, files in os.walk(data_dir):
            for file in files:
                full_p = os.path.join(root, file)
                rel_p = os.path.relpath(full_p, PROJECT_DIR)
                
                # Check if this is a shard file (b00.json ... b99.json)
                is_shard = False
                if "bkrs" in rel_p and file.startswith("b") and file.endswith(".json") and len(file) == 8 and file[1:3].isdigit():
                    is_shard = True
                    
                if is_shard and not include_shards:
                    continue # skip shard in lite build
                    
                zf.write(full_p, rel_p)
                
    size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"DONE: {zip_path} ({size_mb:.2f} MB)\n")

if __name__ == "__main__":
    lite_zip = os.path.join(OUT_DIR, "ChinesePlatform_AppMint_Lite.zip")
    make_zip(lite_zip, include_shards=False)
    
    # Copy lite to flash root
    lite_flash = os.path.join(FLASH_ROOT, "ChinesePlatform_AppMint_Lite.zip")
    shutil.copy2(lite_zip, lite_flash)
    print(f"Copied lite to {lite_flash}")

    # Full zip
    full_zip = os.path.join(OUT_DIR, "ChinesePlatform_AppMint_Full.zip")
    make_zip(full_zip, include_shards=True)
    full_flash = os.path.join(FLASH_ROOT, "ChinesePlatform_AppMint_Full.zip")
    shutil.copy2(full_zip, full_flash)
    print(f"Copied full to {full_flash}")
