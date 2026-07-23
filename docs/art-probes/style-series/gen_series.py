import json
import time
import urllib.request

API = 'http://127.0.0.1:8188'

STYLE = ('elegant chinese manhua game character art, refined oriental style, {subject}, '
         'full body standing pose, clean elegant lineart, soft cel shading with painterly touches, '
         'muted pastel palette with jewel accent colors, {bg}, gacha game splash art, crisp details')
NEGATIVE = ('signature, artist watermark, photograph, photorealistic, 3d render, chibi, western cartoon, watermark, text, '
            'nameplate, banner, logo, ui elements, lowres, blurry, extra fingers, deformed hands')

HEROES = [
    ('longnu_water', 'ref_water.png',
     'beautiful young water goddess Long Nu daughter of the Dragon King, flowing aqua and teal hanfu '
     'with silver dragon embroidery, water ribbons swirling around her, pearl hair ornaments',
     'misty moonlit lake background with soft blue tones'),
    ('zhuque_fire', 'ref_fire.png',
     'fierce beautiful fire warrior maiden Vermilion Bird Zhu Que, crimson and gold armored hanfu '
     'with phoenix feather motifs, burning wings aura, twin curved blades',
     'ember palace background with warm red and orange tones'),
    ('mengpo_yin', 'ref_yin.png',
     'mysterious elegant priestess Meng Po keeper of the bridge of forgetfulness, dark violet and '
     'black layered robes with silver moon embroidery, glowing lantern in hand, pale serene face',
     'twilight underworld pond background with purple mist'),
]


def build_workflow(name, ref, subject, bg, seed):
    return {'prompt': {
        '4': {'class_type': 'CheckpointLoaderSimple',
              'inputs': {'ckpt_name': 'DreamShaperXL_Turbo_v2_1.safetensors'}},
        '5': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 832, 'height': 1216, 'batch_size': 1}},
        '6': {'class_type': 'CLIPTextEncode',
              'inputs': {'clip': ['4', 1], 'text': STYLE.format(subject=subject, bg=bg)}},
        '7': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['4', 1], 'text': NEGATIVE}},
        '10': {'class_type': 'IPAdapterUnifiedLoader',
               'inputs': {'model': ['4', 0], 'preset': 'PLUS (high strength)'}},
        '11': {'class_type': 'LoadImage', 'inputs': {'image': ref}},
        '12': {'class_type': 'IPAdapter',
               'inputs': {'model': ['10', 0], 'ipadapter': ['10', 1], 'image': ['11', 0],
                          'weight': 0.75, 'start_at': 0.0, 'end_at': 1.0, 'weight_type': 'standard'}},
        '3': {'class_type': 'KSampler',
              'inputs': {'model': ['12', 0], 'positive': ['6', 0], 'negative': ['7', 0],
                         'latent_image': ['5', 0], 'seed': seed, 'steps': 7, 'cfg': 2.0,
                         'sampler_name': 'dpmpp_sde', 'scheduler': 'karras', 'denoise': 1.0}},
        '8': {'class_type': 'VAEDecode', 'inputs': {'samples': ['3', 0], 'vae': ['4', 2]}},
        '9': {'class_type': 'SaveImage', 'inputs': {'images': ['8', 0], 'filename_prefix': f'series_{name}'}},
    }}


def post(path, payload):
    req = urllib.request.Request(API + path, json.dumps(payload).encode(), {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read())


for name, ref, subject, bg in HEROES:
    r = post('/prompt', build_workflow(name, ref, subject, bg, seed=20260723))
    pid = r['prompt_id']
    for _ in range(120):
        time.sleep(3)
        h = json.loads(urllib.request.urlopen(f'{API}/history/{pid}').read())
        if pid in h and h[pid].get('status', {}).get('completed'):
            imgs = [o['filename'] for o in h[pid]['outputs']['9']['images']]
            print(name, 'DONE', imgs)
            break
    else:
        print(name, 'TIMEOUT')
