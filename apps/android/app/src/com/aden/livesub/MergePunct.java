package com.aden.livesub;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Chinese: transfer SenseVoice's punctuation, Arabic numerals and Latin words onto the Zipformer output (more accurate characters, no punctuation).
 * Port of merge-punct.js: character-level edit-distance alignment.
 */
public final class MergePunct {
  private MergePunct() {}
  private static final Pattern PUNCT = Pattern.compile("[，。！？、；：,.!?;:…—「」『』“”\"'（）()《》]");
  private static final String DIG = "零一二三四五六七八九";

  static final class Unit { String ch; String after; String num; int numLen; String latin; }

  static List<String> readings(String num) {
    String s = num.replaceAll("[,，]", "");
    StringBuilder per = new StringBuilder();
    for (char c : s.toCharArray()) per.append(c == '.' ? "点" : (c >= '0' && c <= '9') ? String.valueOf(DIG.charAt(c - '0')) : String.valueOf(c));
    LinkedHashSet<String> out = new LinkedHashSet<String>();
    out.add(per.toString());
    if (s.matches("\\d{1,5}")) {
      int n = Integer.parseInt(s);
      String[] u = {"", "十", "百", "千", "万"};
      StringBuilder r = new StringBuilder(); boolean zero = false; String str = String.valueOf(n);
      for (int i = 0; i < str.length(); i++) {
        int d = str.charAt(i) - '0', p = str.length() - 1 - i;
        if (d == 0) { zero = true; continue; }
        if (zero && r.length() > 0) r.append('零');
        zero = false; r.append(DIG.charAt(d)).append(u[p]);
      }
      String rs = n == 0 ? "零" : r.toString();
      out.add(rs); out.add(rs.replaceFirst("^一十", "十")); out.add(rs.replaceFirst("^二(?=[百千万])", "两"));
    }
    return new ArrayList<String>(out);
  }

  static List<Unit> units(String sv, String guess) {
    List<Unit> u = new ArrayList<Unit>();
    Matcher m = Pattern.compile("[A-Za-z][A-Za-z0-9'’.&+-]*|\\d+(?:[.,]\\d+)*%?|.", Pattern.DOTALL).matcher(sv);
    while (m.find()) {
      String t = m.group();
      if (Character.isLetter(t.charAt(0)) && t.charAt(0) < 128) {
        Unit x = new Unit(); x.ch = "\u0000" + t; x.latin = t.replaceAll("[.]+$", ""); u.add(x);
      } else if (Character.isDigit(t.charAt(0))) {
        boolean pct = t.endsWith("%"); String core = pct ? t.substring(0, t.length() - 1) : t;
        List<String> rs = readings(core);
        String r = null;
        for (String x : rs) { String y = pct ? "百分之" + x : x; if (guess.contains(y)) { r = y; break; } }
        if (r == null) r = (pct ? "百分之" : "") + rs.get(rs.size() > 1 ? 1 : 0);
        int[] cps = r.codePoints().toArray();
        for (int i = 0; i < cps.length; i++) { Unit x = new Unit(); x.ch = new String(Character.toChars(cps[i])); if (i == 0) { x.num = t; x.numLen = cps.length; } u.add(x); }
      } else if (PUNCT.matcher(t).matches()) {
        if (!u.isEmpty()) { Unit last = u.get(u.size() - 1); last.after = (last.after == null ? "" : last.after) + t; }
      } else if (!t.trim().isEmpty() && !Character.isLowSurrogate(t.charAt(0))) {
        Unit x = new Unit(); x.ch = t; u.add(x);
      }
    }
    return u;
  }

  public static String transfer(String zf, String sv) {
    if (zf == null || zf.isEmpty() || sv == null || sv.isEmpty()) return zf == null ? "" : zf;
    String zs = zf.replaceAll("(?<![A-Za-z0-9])\\s+|\\s+(?![A-Za-z0-9])", "");
    int[] bc = zs.codePoints().toArray();
    String[] b = new String[bc.length];
    for (int i = 0; i < bc.length; i++) b[i] = new String(Character.toChars(bc[i]));
    List<Unit> a = units(sv, zf);
    if (a.isEmpty() || b.length == 0) return zf;
    int n = a.size(), m = b.length;
    int[][] D = new int[n + 1][m + 1];
    for (int i = 0; i <= n; i++) D[i][0] = i;
    for (int j = 0; j <= m; j++) D[0][j] = j;
    for (int i = 1; i <= n; i++) for (int j = 1; j <= m; j++)
      D[i][j] = Math.min(Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1), D[i - 1][j - 1] + (a.get(i - 1).ch.equals(b[j - 1]) ? 0 : 1));
    int[] map = new int[n];
    for (int i = 0; i < n; i++) map[i] = -1;
    for (int i = n, j = m; i > 0 || j > 0;) {
      if (i > 0 && j > 0 && D[i][j] == D[i - 1][j - 1] + (a.get(i - 1).ch.equals(b[j - 1]) ? 0 : 1)) { map[i - 1] = j - 1; i--; j--; }
      else if (i > 0 && D[i][j] == D[i - 1][j] + 1) { map[i - 1] = -1; i--; }
      else j--;
    }
    String[] after = new String[m];
    for (int j = 0; j < m; j++) after[j] = "";
    String zfLower = zf.toLowerCase();
    StringBuilder lead = new StringBuilder();
    Map<Integer, int[]> numAt = new HashMap<Integer, int[]>();
    Map<Integer, String> numText = new HashMap<Integer, String>();
    int lastJ = -1;
    for (int i = 0; i < n; i++) {
      Unit x = a.get(i);
      if (map[i] >= 0) lastJ = map[i];
      if (x.num != null) {
        boolean ok = true; int j0 = map[i];
        for (int k = 0; k < x.numLen; k++) { if (i + k >= n) { ok = false; break; } int jj = map[i + k]; if (jj != j0 + k || jj < 0 || !a.get(i + k).ch.equals(b[jj])) { ok = false; break; } }
        if (ok && j0 >= 0) { numAt.put(j0, new int[]{x.numLen}); numText.put(j0, x.num); }
      }
      if (x.latin != null && x.latin.length() >= 2 && map[i] < 0 && !zfLower.contains(x.latin.toLowerCase())) {
        if (lastJ >= 0) after[lastJ] += (after[lastJ].matches(".*[A-Za-z0-9]$") ? " " : "") + x.latin; else lead.append(x.latin);
      }
      if (x.after != null) {
        int j = map[i] >= 0 ? map[i] : lastJ;
        if (j >= 0 && !after[j].contains(x.after)) after[j] += x.after;
        else if (j < 0) lead.append(x.after.replaceAll("[，。！？、；：,.!?;:]", ""));
      }
    }
    String tail = a.get(n - 1).after;
    if (tail != null && after[m - 1].isEmpty()) { for (int j = 0; j < m - 1; j++) if (after[j].equals(tail) && j >= m - 3) after[j] = ""; after[m - 1] = tail; }
    StringBuilder out = new StringBuilder(lead);
    for (int j = 0; j < m; j++) {
      if (numAt.containsKey(j)) { int len = numAt.get(j)[0]; out.append(numText.get(j)); j += len - 1; out.append(after[j]); continue; }
      out.append(b[j]).append(after[j]);
    }
    return out.toString().replaceAll("([？！。?!…])[，、,；;]+", "$1").replaceAll("([，、])[，、]+", "$1");
  }
}
