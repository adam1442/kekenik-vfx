// shapes2d.wgsl — shared 2D SDFs for regular polygons and stars (y-UP space: the shape points up). Negative inside.
// Used by grayscale.shape and grayscale.polar_scatter. Pure module (no bindings).
#include "common"

fn sd_reg_polygon(p: vec2f, r: f32, n: f32) -> f32 {
  let an = PI / n;
  let acs = vec2f(cos(an), sin(an));
  let two = 2.0 * an;
  let bn = ((atan2(p.x, p.y) % two) + two) % two - an;
  var q = length(p) * vec2f(cos(bn), abs(sin(bn)));
  q = q - r * acs;
  q.y = q.y + clamp(-q.y, 0.0, r * acs.y);
  return length(q) * select(-1.0, 1.0, q.x > 0.0);
}

fn sd_star(p: vec2f, r: f32, n: f32, m: f32) -> f32 {
  let an = PI / n;
  let en = PI / m;
  let acs = vec2f(cos(an), sin(an));
  let ecs = vec2f(cos(en), sin(en));
  let two = 2.0 * an;
  let bn = ((atan2(p.x, p.y) % two) + two) % two - an;
  var q = length(p) * vec2f(cos(bn), abs(sin(bn)));
  q = q - r * acs;
  q = q + ecs * clamp(-dot(q, ecs), 0.0, r * acs.y / ecs.y);
  return length(q) * select(-1.0, 1.0, q.x > 0.0);
}
