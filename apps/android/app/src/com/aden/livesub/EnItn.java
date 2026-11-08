package com.aden.livesub;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** English inverse text normalization (port of en-itn.js): "twenty twenty one" -> 2021, "seven percent" -> 7% */
public final class EnItn {
  private EnItn() {}
  static final Map<String, Integer> UNITS = new HashMap<String, Integer>(), TENS = new HashMap<String, Integer>();
  static final Map<String, Double> SCALES = new HashMap<String, Double>();
  static {
    String[] u = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"};
    for (int i = 0; i < u.length; i++) UNITS.put(u[i], i);
    UNITS.put("oh", 0);
    String[] t = {"twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"};
    for (int i = 0; i < t.length; i++) TENS.put(t[i], 20 + i * 10);
    SCALES.put("hundred", 100.0); SCALES.put("thousand", 1e3); SCALES.put("million", 1e6); SCALES.put("billion", 1e9); SCALES.put("trillion", 1e12);
  }
  static boolean isNum(String w) { return UNITS.containsKey(w) || TENS.containsKey(w) || SCALES.containsKey(w); }

  static final class G { double total, small; boolean scale; String lastScale; String last; int words; }

  static List<G> parseGroups(List<String> words) {
    List<G> groups = new ArrayList<G>(); G cur = null;
    for (String w : words) {
      if (w.equals("and")) { if (cur == null || !"scale".equals(cur.last)) return null; continue; }
      if (SCALES.containsKey(w)) {
        if (cur == null) return null;
        double s = SCALES.get(w);
        if (s == 100) cur.small = (cur.small == 0 ? 1 : cur.small) * 100;
        else { cur.total += (cur.small == 0 ? 1 : cur.small) * s; cur.small = 0; cur.lastScale = w; }
        cur.scale = true; cur.last = "scale"; continue;
      }
      int v = UNITS.containsKey(w) ? UNITS.get(w) : TENS.get(w);
      if (cur != null) {
        boolean continues = ("tens".equals(cur.last) && UNITS.containsKey(w) && v < 10) || "scale".equals(cur.last);
        if (!continues) { groups.add(cur); cur = null; }
      }
      if (cur == null) cur = new G();
      cur.small += v; cur.words++;
      cur.last = TENS.containsKey(w) ? "tens" : "unit";
    }
    if (cur != null) groups.add(cur);
    return groups;
  }

  static String fmt(double v) { return v == Math.floor(v) ? String.valueOf((long) v) : String.valueOf(v); }

  static String render(List<String> words) {
    List<G> gs = parseGroups(words);
    if (gs == null) return null;
    if (gs.size() == 2) {
      G a = gs.get(0), b = gs.get(1); double av = a.total + a.small, bv = b.total + b.small;
      if (!a.scale && !b.scale && av >= 10 && av <= 99 && ((bv >= 10 && bv <= 99) || words.get(words.size() - 1).equals("hundred")))
        return fmt(av) + (bv < 10 ? "0" : "") + fmt(bv);
      if (!a.scale && av >= 10 && av <= 99 && words.size() >= 2 && words.get(words.size() - 2).equals("oh") && bv < 10) return fmt(av) + "0" + fmt(bv);
    }
    if (gs.size() != 1) return null;
    G g = gs.get(0);
    if (g.lastScale != null && Arrays.asList("million", "billion", "trillion").contains(g.lastScale) && g.small == 0) {
      double pre = g.total / SCALES.get(g.lastScale);
      if (pre == Math.floor(pre) && pre < 1000) return fmt(pre) + " " + g.lastScale;
    }
    return fmt(g.total + g.small);
  }

  static final class W { String raw, word, pre = "", post = ""; }

  public static String apply(String text) {
    if (text == null || text.isEmpty()) return text;
    String[] toks = text.trim().split("\\s+");
    List<W> ws = new ArrayList<W>();
    Pattern p = Pattern.compile("^([^A-Za-z]*)([A-Za-z]+(?:-[A-Za-z]+)?)([^A-Za-z]*)$");
    for (String t : toks) {
      W w = new W(); w.raw = t; Matcher m = p.matcher(t);
      if (m.matches()) { w.pre = m.group(1); w.raw = m.group(2); w.word = m.group(2).toLowerCase(); w.post = m.group(3); }
      ws.add(w);
    }
    List<String> out = new ArrayList<String>();
    for (int k = 0; k < ws.size();) {
      W w = ws.get(k);
      boolean numWord = w.word != null && !SCALES.containsKey(w.word) && allNum(w.word.split("-"));
      if (numWord) {
        List<String> span = new ArrayList<String>(); int j = k;
        while (j < ws.size()) {
          W x = ws.get(j); if (x.word == null) break;
          if (j > k && !x.pre.isEmpty()) break;
          String[] ps = x.word.split("-");
          boolean ok = allNum(ps)
            || (x.word.equals("and") && !span.isEmpty() && j + 1 < ws.size() && ws.get(j + 1).word != null && isNum(ws.get(j + 1).word))
            || (x.word.equals("point") && !span.isEmpty() && j + 1 < ws.size() && ws.get(j + 1).word != null && UNITS.containsKey(ws.get(j + 1).word));
          if (!ok) break;
          span.addAll(Arrays.asList(ps)); j++;
          if (!x.post.isEmpty()) break;
        }
        while (!span.isEmpty() && span.get(span.size() - 1).equals("and")) { span.remove(span.size() - 1); j--; }
        String str = null; int pi = span.indexOf("point");
        if (pi > 0) {
          List<String> left = span.subList(0, pi); boolean hasScale = false;
          for (String x : left) if (SCALES.containsKey(x)) hasScale = true;
          String a = hasScale ? null : render(left);
          StringBuilder frac = new StringBuilder(); boolean fok = true;
          for (String x : span.subList(pi + 1, span.size())) { Integer d = UNITS.get(x); if (d == null || d >= 10) { fok = false; break; } frac.append(d); }
          if (a != null && fok && frac.length() > 0) str = a + "." + frac;
        } else str = render(span);
        W next = j < ws.size() ? ws.get(j) : null;
        boolean pct = next != null && "percent".equals(next.word);
        boolean prevQ = !out.isEmpty() && k > 0 && ws.get(k - 1).raw.matches("(?i)^Q$");
        double val = Double.NaN;
        if (str != null) { try { val = Double.parseDouble(str.split(" ")[0]); } catch (NumberFormatException e) { val = Double.NaN; } }
        if (str != null && (pct || prevQ || val >= 10 || str.contains(".") || str.matches(".*\\d \\w.*"))) {
          String s = w.pre + str; W last = ws.get(j - 1);
          if (pct) { s += "%"; last = next; j++; }
          s += last.post;
          if (prevQ) { String q = out.remove(out.size() - 1); s = q.trim() + s.trim(); }
          out.add(s); k = j; continue;
        }
      }
      out.add(w.word == null ? w.raw : w.pre + w.raw + w.post);
      k++;
    }
    return String.join(" ", out).replaceAll("\\s+", " ").trim();
  }

  static boolean allNum(String[] ps) { for (String x : ps) if (!isNum(x)) return false; return ps.length > 0; }
}
