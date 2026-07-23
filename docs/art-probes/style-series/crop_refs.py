from PIL import Image

HB = 'd:/projects/match-battle/docs/research/art/oth_live/handbook'
INP = 'd:/app/ComfyUI_windows_portable/ComfyUI/input'

crops = [
    (f'{HB}/water_01.png', f'{INP}/ref_water.png'),
    (f'{HB}/fire_02.png', f'{INP}/ref_fire.png'),
    (f'{HB}/yin_01.png', f'{INP}/ref_yin.png'),
]
for src, dst in crops:
    Image.open(src).crop((170, 205, 910, 955)).save(dst)
    print(dst)
