#include "goo_effect.slang"

static const float3 Lime = float3(0.402, 1.0, 0.0);
static const float3 Orange = float3(1.0, 0.402, 0.0);
static const float3 Blue = float3(0.0, 0.402, 1.0);
static const float3 Mint = float3(0.0, 1.0, 0.402);
static const float3 Violet = float3(0.402, 0.0, 1.0);
static const float3 Pink = float3(1.0, 0.0, 0.402);
static const float3 Neon[6] = { Lime, Orange, Pink, Blue, Mint, Violet };
static const uint Glyphs[16] = { 31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695, 1899, 19822, 1827, 5995, 1507, 5586 };
static const float2 GlyphCell = float2(4.0, 7.0);

static float time;
static float4 tint;

float hash(float3 p)
{
    p = frac(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return frac((p.x + p.y) * p.z);
}

float2 rotate(float2 v, float angle)
{
    float c = cos(angle);
    float s = sin(angle);
    return float2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float3 orient(float3 q)
{
    q.xz = rotate(q.xz, time * 0.25);
    q.yz = rotate(q.yz, 0.35 + time * 0.08);
    return q;
}

float field(float3 q)
{
    float3 o = orient(q);
    float3 s = o * 5.0;
    return max(abs(dot(sin(s), cos(s.yzx))) / 5.0 - 0.025, length(o) - 1.0);
}

float shadow(float3 p, float3 light)
{
    float result = 1.0;
    float s = 0.02;
    for (int i = 0; i < 16; i++)
    {
        float h = field(p + light * s);
        result = min(result, 8.0 * h / s);
        s += clamp(h, 0.02, 0.15);
        if (result < 0.02 || s > 2.0)
        {
            break;
        }
    }
    return saturate(result);
}

float occlusion(float3 p, float3 n)
{
    float a = 0.0;
    float w = 1.0;
    for (int i = 1; i <= 4; i++)
    {
        float h = 0.04 * float(i);
        a += (h - field(p + n * h)) * w;
        w *= 0.6;
    }
    return saturate(1.0 - 3.0 * a);
}

float bayer2(float2 a)
{
    a = floor(a);
    return frac(a.x / 2.0 + a.y * a.y * 0.75);
}

float bayer4(float2 a)
{
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

float bayer8(float2 a)
{
    return bayer4(0.5 * a) * 0.25 + bayer2(a);
}

float2 scene(float2 pixel, float4 view)
{
    float4 frame = gooParameter(2);
    float2 origin = float2(view.x * view.w, view.y * frame.y);
    return float2(pixel.x - origin.x, origin.y - pixel.y) / view.y * frame.x;
}

float4 gyroid(float2 cell, float4 view)
{
    float2 p = scene((cell + 0.5) * view.z, view);
    float3 ro = float3(0.0, 0.0, -3.5);
    float3 rd = normalize(float3(p, 1.0));
    float b = dot(ro, rd);
    float h = b * b - dot(ro, ro) + 1.0;
    if (h <= 0.0)
    {
        return tint;
    }
    float s = -b - sqrt(h);
    float far = -b + sqrt(h);
    bool hit = false;
    for (int i = 0; i < 96; i++)
    {
        float d = field(ro + rd * s);
        if (d < 0.0008)
        {
            hit = true;
            break;
        }
        s += d * 0.7;
        if (s > far)
        {
            break;
        }
    }
    if (!hit)
    {
        return tint;
    }
    float3 q = ro + rd * s;
    float2 e = float2(0.002, 0.0);
    float3 n = normalize(float3(
        field(q + e.xyy) - field(q - e.xyy),
        field(q + e.yxy) - field(q - e.yxy),
        field(q + e.yyx) - field(q - e.yyx)));
    float3 light = normalize(float3(-0.5, 0.8, -0.6));
    float3 r = reflect(rd, n);
    float ao = occlusion(q, n);
    float sh = shadow(q + n * 0.004, light);
    float diffuse = max(0.0, dot(n, light)) * sh;
    float fresnel = pow(1.0 - abs(dot(n, rd)), 3.0);
    float specular = pow(max(0.0, dot(r, light)), 28.0) * sh;
    float fill = max(0.0, dot(n, normalize(float3(0.7, -0.3, -0.4))));
    float shade = ((0.18 + 1.1 * diffuse + 0.25 * fill) * 0.55 + specular * 0.8 + fresnel * 0.35) * ao;
    shade *= lerp(1.0, 0.35, smoothstep(-1.0, 1.0, q.z));
    float level = saturate(pow(shade, 1.3) * 1.5);
    if (level <= bayer8(cell) * 0.94 + 0.03)
    {
        return tint;
    }
    float3 band = q.z < -0.55 ? Lime : q.z < -0.2 ? Mint : q.z < 0.2 ? Blue : Violet;
    if (n.y < -0.75)
    {
        band = Orange;
    }
    float3 color = band * (0.45 + 0.55 * shade);
    return float4(color * min(1.0, 0.85 / max(color.r, max(color.g, max(color.b, 0.001)))), 1.0);
}

bool lit(float digit, float2 bit)
{
    if (bit.x > 2.0 || bit.y > 4.0)
    {
        return false;
    }
    return ((Glyphs[uint(digit)] >> uint(14.0 - bit.y * 3.0 - bit.x)) & 1u) != 0u;
}

float4 code(float2 glyph, float2 bit, float resolve)
{
    float clock = time * lerp(0.12, 0.4, hash(float3(glyph, 1.0))) + hash(float3(glyph, 2.0)) * 8.0;
    float epoch = floor(clock);
    float age = clock - epoch;
    bool blank = hash(float3(glyph, epoch + 0.3)) < 0.45;
    float roll = age < 0.1 ? floor(time * 15.0) : epoch;
    float digit = floor(hash(float3(glyph, roll + 0.7)) * 16.0);
    float3 color = float3(0.02 + 0.03 * hash(float3(glyph, 3.0)));
    if (hash(float3(glyph, epoch + 0.5)) < 0.015)
    {
        float3 neon = Neon[uint(hash(float3(glyph, epoch + 0.9)) * 6.0)];
        color = lerp(neon, color, smoothstep(0.15, 1.0, age));
    }
    if (resolve < 1.0)
    {
        float flash = 1.0 - resolve;
        float3 neon = Neon[uint(hash(float3(glyph, 4.0)) * 6.0)];
        color = blank ? neon * flash * flash : lerp(color, neon, flash);
        digit = flash > 0.35 ? floor(hash(float3(glyph, floor(time * 20.0))) * 16.0) : digit;
        blank = false;
    }
    return blank || !lit(digit, bit) ? tint : float4(color, 1.0);
}

float4 gooEffect(float2 uv, float4 source, float4 backdrop)
{
    float4 view = gooParameter(0);
    float4 shape = gooParameter(3);
    tint = float4(0.0, 0.0, 0.0, shape.z);
    time = gooElapsedSeconds();
    float2 pixel = uv * view.xy;
    float2 cell = floor(pixel / view.z);
    float2 local = pixel - cell * view.z;
    bool dotted = local.x < view.z - 1.0 && local.y < max(view.z - 1.0, 2.0);
    if (shape.x <= 0.0)
    {
        return dotted ? gyroid(cell, view) : tint;
    }
    float2 mark = floor(pixel / shape.y);
    float2 glyph = floor(mark / GlyphCell);
    float spread = length(scene((glyph + 0.5) * GlyphCell * shape.y, view));
    float order = 0.82 * (0.4 * hash(float3(glyph, 5.0)) + 0.6 * saturate(spread * 1.1));
    float resolve = (shape.x - order) / 0.18;
    if (resolve < 0.0)
    {
        return dotted ? gyroid(cell, view) : tint;
    }
    return length(pixel / shape.y - mark - 0.5) > 0.36 ? tint : code(glyph, mark - glyph * GlyphCell, resolve);
}
