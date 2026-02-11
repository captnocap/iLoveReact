from PIL import Image
import sys

# ASCII characters from dark to light (gradient mode)
ASCII_CHARS = ["@", "#", "S", "%", "?", "*", "+", ";", ":", ",", "."]

# Block mode: binary filled (#) vs empty (space)
BLOCK_THRESHOLD = 60  # pixels brighter than this become filled

def resize_image_fixed_height(image, new_height=26):
    width, height = image.size
    aspect_ratio = width / height
    # Correct for terminal character aspect ratio (approx 0.55 width/height -> 1/0.55 = ~1.8 correction, 
    # but 1.65 is a common approximation for typical fonts)
    new_width = int(new_height * aspect_ratio * 1.7) 
    return image.resize((new_width, new_height))

def resize_image_width(image, new_width=100):
    width, height = image.size
    ratio = height / width / 0.55 # 0.55 is approx aspect ratio of a char
    new_height = int(new_width * ratio)
    return image.resize((new_width, new_height))

def pixel_to_ascii(image):
    pixels = image.getdata()
    characters = "".join([ASCII_CHARS[pixel * len(ASCII_CHARS) // 256] for pixel in pixels])
    return characters

def pixel_to_block(image):
    pixels = image.getdata()
    characters = "".join(["#" if pixel >= BLOCK_THRESHOLD else " " for pixel in pixels])
    return characters

def main(image_path):
    try:
        img = Image.open(image_path)
    except Exception as e:
        print(f"Unable to open image file {image_path}. {e}")
        return

    # Convert to grayscale
    gray_img = img.convert("L")

    print(f"Processing image: {image_path}")
    
    # Constraint A: Fixed height 26
    print("\n" + "="*40)
    print(" CONSTRAINT A: Fixed Note Height (26)")
    print("="*40)
    
    img_a = resize_image_fixed_height(gray_img, 26)
    ascii_str_a = pixel_to_ascii(img_a)
    img_width_a = img_a.width
    
    ascii_img_a = "\n".join([ascii_str_a[index:(index+img_width_a)] for index in range(0, len(ascii_str_a), img_width_a)])
    print(ascii_img_a)

    # Constraint B: High Detail (Heuristic width)
    print("\n" + "="*40)
    print(" CONSTRAINT B: High Detail")
    print("="*40)
    
    # Calculate "High Detail" based on terminal width or arbitrary high res
    # Let's target a width of 120 chars for safe terminal viewing
    img_b = resize_image_width(gray_img, 120)
    ascii_str_b = pixel_to_ascii(img_b)
    img_width_b = img_b.width
    
    ascii_img_b = "\n".join([ascii_str_b[index:(index+img_width_b)] for index in range(0, len(ascii_str_b), img_width_b)])
    print(ascii_img_b)

    # Constraint C: Block mode (binary filled/empty, fixed height 26)
    # Use square pixels (no terminal aspect ratio correction)
    print("\n" + "="*40)
    print(" CONSTRAINT C: Block Mode (26 rows)")
    print("="*40)

    width, height = gray_img.size
    aspect_ratio = width / height
    sq_width = int(26 * aspect_ratio)
    img_c = gray_img.resize((sq_width, 26))
    block_str = pixel_to_block(img_c)
    img_width_c = img_c.width

    block_img = "\n".join([block_str[index:(index+img_width_c)] for index in range(0, len(block_str), img_width_c)])
    print(block_img)

    # Save to file
    with open("ascii_art.txt", "w") as f:
        f.write("CONSTRAINT A: Fixed Height (26)\n")
        f.write("="*40 + "\n")
        f.write(ascii_img_a + "\n\n")
        f.write("CONSTRAINT B: High Detail\n")
        f.write("="*40 + "\n")
        f.write(ascii_img_b + "\n\n")
        f.write("CONSTRAINT C: Block Mode (26 rows)\n")
        f.write("="*40 + "\n")
        f.write(block_img + "\n")

    print("\nOutput saved to 'ascii_art.txt'")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ascii_converter.py <image_path>")
    else:
        main(sys.argv[1])
