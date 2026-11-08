package com.aden.livesub;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Recognition post-processing and language helpers (port of postprocess.js / lang-text.js) */
public final class Text {
  private Text() {}

  private static final String CJK = "\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f\\u3000-\\u303f\\uff01-\\uff0f\\uff1a-\\uff20";
  private static final Pattern SPACE_BETWEEN_CJK = Pattern.compile("(?<=[" + CJK + "])\\s+(?=[" + CJK + "])");
  private static final Pattern PUNCT_ONLY = Pattern.compile("^[\\s\\p{P}\\p{S}]*$");
  private static final Pattern MUSIC_ONLY = Pattern.compile("^[\\s♪♫🎵🎶()（）\\[\\]【】「」『』。、,.!?！？…~〜ー-]*(音楽|拍手|笑い|music|applause|laughter|BGM)?[\\s♪♫🎵🎶()（）\\[\\]【】。、,.!?！？…~〜ー-]*$", Pattern.CASE_INSENSITIVE);
  private static final Pattern EN_UM = Pattern.compile("(^|[\\s,])(?:um+|uh+|erm|uhm)(?=[\\s,.!?]|$)[,]?", Pattern.CASE_INSENSITIVE);
  /** Isolated English fillers inside Japanese/Chinese content (noise and laughter are often recognized as these) */
  public static final Pattern EN_FILLER = Pattern.compile("^(?:ok(?:ay)?|o\\.k\\.|yeah|yes|yep|yup|no|oh|ah|uh|um|hmm+|mm+|wow|bye|hi|hey|thank you|thanks|you|so|well|right|i|the|and|of the)(?:[\\s,.!?]+(?:ok(?:ay)?|yeah|yes|oh|thank you|bye))*[\\s,.!?]*$", Pattern.CASE_INSENSITIVE);

  /** Collapse repetition loops from the recognizer: 'ですですですです' */
  public static String collapseRepeats(String text) {
    String t = text.replaceAll("(.)\\1{4,}", "$1$1$1$1");
    return t.replaceAll("(.{2,12}?)\\1{2,}", "$1");
  }

  /** @return empty string means drop */
  public static String clean(String text, String lang) {
    String t = text == null ? "" : text.replaceAll("\\s+", " ").trim();
    if ("ja".equals(lang) || "zh".equals(lang)) t = SPACE_BETWEEN_CJK.matcher(t).replaceAll("");
    t = collapseRepeats(t);
    if ("en".equals(lang)) {
      t = EN_UM.matcher(t).replaceAll("$1").replaceAll("\\s{2,}", " ").replaceAll("^\\s*,\\s*", "").replaceAll("\\s+([,.!?])", "$1").trim();
    }
    t = t.replaceAll("^[、。,.]+", "").trim();
    if (PUNCT_ONLY.matcher(t).matches()) return "";
    if (MUSIC_ONLY.matcher(t).matches()) return "";
    return t;
  }

  private static final Pattern JA_CONTINUES = Pattern.compile("(と|が|て|で|に|を|は|も|の|や|へ|から|けど|けれど|ので|のに|し|り|ば|たら|なら|ながら|ため|より|まで|って|という|ような|ように|そして|それで|でも|だけど|あと|、)$");
  private static final Pattern EN_CONTINUES = Pattern.compile("\\b(and|or|but|the|a|an|to|of|in|on|with|that|which|because|so|if|when)$", Pattern.CASE_INSENSITIVE);

  /** Is the sentence unfinished? (decides whether to join it with the next segment and whether translation waits) */
  public static boolean looksIncomplete(String text, String lang) {
    String t = (text == null ? "" : text.trim()).replaceAll("[。．.]+$", "");
    if (t.isEmpty()) return false;
    if (t.matches(".*[？?！!]$")) return false;
    if ("ja".equals(lang)) return JA_CONTINUES.matcher(t).find();
    if ("en".equals(lang)) return EN_CONTINUES.matcher(t).find() || t.endsWith(",");
    if ("zh".equals(lang)) return t.matches(".*[，、的地得和与或但而且并在把被让给对从向]$");
    if ("ko".equals(lang)) return t.matches(".*[,，]$") || t.matches(".*(고|는데|지만|서|면|며|니까|아서|어서)$");
    return false;
  }

  private static int count(String s, String re) { Matcher m = Pattern.compile(re).matcher(s); int n = 0; while (m.find()) n++; return n; }

  /** Rough language guess: ja / zh / en / ko / null */
  public static String guessLang(String s) {
    if (s == null) return null;
    int kana = count(s, "[\\u3040-\\u30ff]"), han = count(s, "[\\u3400-\\u9fff]"), hangul = count(s, "[\\uac00-\\ud7af]"), words = count(s, "[A-Za-z]+");
    int n = kana + han + hangul + words;
    if (n == 0) return null;
    if (kana >= 1 && kana / (double) Math.max(1, kana + han) > 0.1) return "ja";
    if (hangul / (double) n > 0.3) return "ko";
    if (han / (double) n >= 0.3) return "zh";
    if (words / (double) n > 0.6) return "en";
    return null;
  }

  public static String base(String code) { if (code == null) return ""; int i = code.indexOf('-'); return i < 0 ? code : code.substring(0, i); }
  public static boolean isCjk(String lang) { String b = base(lang); return "ja".equals(b) || "zh".equals(b) || "ko".equals(b); }

  /** Subtitle style: drop the sentence-final period in Chinese/Japanese */
  public static String subtitleStyle(String s, String lang) {
    String b = base(lang);
    if ("zh".equals(b) || "ja".equals(b)) return s.replaceAll("[。．]+$", "");
    return s;
  }

  /** Long lines show only the tail (the newest words matter most), cut at punctuation when possible */
  public static String tail(String text, int max) {
    int[] cps = text.codePoints().toArray();
    if (cps.length <= max) return text;
    int cut = cps.length - max;
    for (int i = cut; i < Math.min(cps.length - 4, cut + 15); i++) {
      String c = new String(Character.toChars(cps[i]));
      if ("、。，,.!?！？ ".contains(c)) return "…" + new String(cps, i + 1, cps.length - i - 1).trim();
    }
    return "…" + new String(cps, cut, cps.length - cut);
  }

  public static int len(String s) { return s == null ? 0 : s.codePointCount(0, s.length()); }
}
