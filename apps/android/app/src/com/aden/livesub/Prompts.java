package com.aden.livesub;

/** LLM translation prompts (port of translate-prompts.js) */
public final class Prompts {
  private Prompts() {}
  static String label(String c) {
    if (c == null) return "the original language";
    if (c.equals("zh-CN")) return "Simplified Chinese"; if (c.equals("zh-TW")) return "Traditional Chinese (Taiwan usage)";
    String b = Text.base(c);
    if (b.equals("ja")) return "Japanese"; if (b.equals("zh")) return "Chinese"; if (b.equals("en")) return "English"; if (b.equals("ko")) return "Korean";
    return c;
  }
  static final String[] COMMON = {
    "Output only the translation, on one line: no explanations, notes, quotes, readings, source text or prefixes like \"Translation:\".",
    "Stay faithful to the source and add nothing; if the source is half a sentence, translate only that half without completing it.",
    "The source comes from speech recognition and may contain homophone errors: infer the intended meaning from context.",
    "Keep translations short and colloquial, suitable as subtitles. Render fillers and interjections as short equivalents.",
    "Accuracy of meaning comes first: where unsure, be vague and conservative rather than confidently wrong.",
    "Spoken language is fast, slurred, elliptical, inverted and self-correcting: translate what the speaker actually means, not word by word.",
    "Never intensify or soften the source (e.g. \"harmed them\" must not become \"killed them\", \"a bit\" must not become \"very\").",
  };
  // direction-specific rules (the CJK examples are part of the instructions)
  static String[] rules(String key) {
    if (key.equals("ja>zh")) return new String[]{
      "Restore subjects/objects omitted in Japanese naturally in Chinese, but do not force in 我/你.",
      "Do not translate Japanese-Chinese false friends literally: 勉強=学习, 手紙=信, 大丈夫=没事/没问题, 怪我=受伤, 迷惑=麻烦, 留守=不在家, 娘=女儿, 邪魔=打扰, 結構=相当/不用了, 無理=不行/勉强.",
      "「お疲れ様」 = 辛苦了, 「よろしくお願いします」 = 请多关照/拜托了 depending on context; 「草」「w」 are laughter: 哈哈/笑死."};
    if (key.equals("zh>ja")) return new String[]{
      "Write natural Japanese (natural casual speech for streams/videos). Use Japanese kanji forms only, never simplified Chinese characters.",
      "Keep Chinese personal and place names in kanji (Japanese forms); render Chinese internet slang with Japanese equivalents (哈哈=笑/ｗ)."};
    if (key.equals("ja>en")) return new String[]{"Fill in omitted subjects naturally; laughter like 「草」「w」 → \"lol\"; fillers like 「えー」「あの」 can be dropped."};
    if (key.equals("ko>zh") || key.equals("ko>ja") || key.equals("ko>en")) return new String[]{"Express Korean honorific levels (-요/-습니다) with a natural degree of politeness in the target language; keep the usual spelling of Korean names."};
    if (key.equals("en>zh")) return new String[]{"Render English slang and idioms as natural spoken Chinese; keep established translations for names, brands and terms."};
    if (key.equals("zh>en")) return new String[]{"Translate Chinese colloquialisms and idioms into natural English by meaning, not word by word. Use pinyin for Chinese names."};
    return new String[0];
  }
  public static String system(String src, String dst) {
    String s = Text.base(src), d = Text.base(dst);
    StringBuilder b = new StringBuilder();
    b.append("You translate live subtitles from ").append(label(src)).append(" into ").append(label(dst)).append(".\nRules:\n");
    int i = 1;
    for (String r : COMMON) b.append(i++).append(". ").append(r).append('\n');
    for (String r : rules(s + ">" + d)) b.append(i++).append(". ").append(r).append('\n');
    if ("zh-TW".equals(dst)) b.append("Use Traditional Chinese characters and Taiwan usage.\n");
    return b.toString().trim();
  }
}
