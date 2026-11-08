package com.aden.livesub;

/** LLM translation prompts (port of translate-prompts.js) */
public final class Prompts {
  private Prompts() {}
  static String label(String c) {
    if (c == null) return "原语言";
    if (c.equals("zh-CN")) return "简体中文"; if (c.equals("zh-TW")) return "繁体中文（台湾用语）";
    String b = Text.base(c);
    if (b.equals("ja")) return "日语"; if (b.equals("zh")) return "中文"; if (b.equals("en")) return "英语"; if (b.equals("ko")) return "韩语";
    return c;
  }
  static final String[] COMMON = {
    "只输出一行译文本身：不要解释、注释、引号、注音、原文或“译文：”之类的前缀。",
    "忠实于原文，不补充原文没有的信息；原文是半句就只译这半句，不要自己补全。",
    "原文来自语音识别，可能有同音字错误：按上下文推断正确意思来译。",
    "译文要短、口语化、适合当字幕。语气词和口头禅译成对应的简短语气词。",
    "意思准确第一：不确定的地方宁可译得含糊、保守，也不要译出确定但可能错误的意思。",
    "口语里常有语速快、连读、省略、倒装、说到一半改口：按说话人真正想表达的意思译，不要逐字直译。",
    "不要加重或减轻原文的程度和语气（例如“害了他们”不能译成“杀了他们”，“有点”不能译成“非常”）。",
  };
  static String[] rules(String key) {
    if (key.equals("ja>zh")) return new String[]{
      "日语省略的主语、宾语按上下文补成自然的中文，但不要硬补“我/你”。",
      "日中同形词别直译：勉強=学习，手紙=信，大丈夫=没事/没问题，怪我=受伤，迷惑=麻烦，留守=不在家，娘=女儿，邪魔=打扰，結構=相当/不用了，無理=不行/勉强。",
      "「お疲れ様」译“辛苦了”，「よろしくお願いします」按语境译“请多关照/拜托了”；「草」「w」是笑声，译“哈哈/笑死”。"};
    if (key.equals("zh>ja")) return new String[]{
      "日语要自然：直播/视频用自然的口语体。只用日文汉字字形，绝对不要出现简体字。",
      "中国人名、地名保留汉字（改为日文字形）；中文网络用语译成意思相同的日语表达（哈哈=笑/ｗ）。"};
    if (key.equals("ja>en")) return new String[]{"Fill in omitted subjects naturally; laughter like 「草」「w」 → \"lol\"; fillers like 「えー」「あの」 can be dropped."};
    if (key.equals("ko>zh") || key.equals("ko>ja") || key.equals("ko>en")) return new String[]{"韩语的敬语（-요/-습니다）按语境用目标语言自然的礼貌程度表达；韩国人名保留常用写法。"};
    if (key.equals("en>zh")) return new String[]{"英文俚语和习语意译成自然的中文口语；人名、品牌、术语保留常用译名。"};
    if (key.equals("zh>en")) return new String[]{"把中文的口语和成语意译成自然英文，不要逐字翻译。中文人名用拼音。"};
    return new String[0];
  }
  public static String system(String src, String dst) {
    String s = Text.base(src), d = Text.base(dst);
    StringBuilder b = new StringBuilder();
    if (d.equals("en")) b.append("You translate live subtitles from ").append(label(src)).append(" into English.\n");
    else b.append("你是实时字幕翻译，把").append(label(src)).append("翻译成").append(label(dst)).append("。\n");
    b.append("规则：\n");
    int i = 1;
    for (String r : COMMON) b.append(i++).append(". ").append(r).append('\n');
    for (String r : rules(s + ">" + d)) b.append(i++).append(". ").append(r).append('\n');
    if ("zh-TW".equals(dst)) b.append("使用台湾繁体字和台湾用语。\n");
    return b.toString().trim();
  }
}
