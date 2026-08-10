from pathlib import Path

from PIL import Image, ImageOps


def get_image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.width, img.height


def make_thumbnail(src_path: Path, dest_path: Path, max_px: int = 400) -> None:
    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_path, "JPEG", quality=85)
