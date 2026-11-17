// Generated from the Hugging Face file listings (api/models/<repo>/tree/main?recursive=true):
// every GGUF quant of each catalog model, with its parts (split GGUFs), sizes and sha256 (LFS oid).
// Quants are named as localllmpicker's QuantBits, none above Q6_K; Unsloth's UD- variant is used when it is
// the only one. MiniCPM5 2B: openbmb's own files first, bartowski's for the other quants.
export interface CatalogFile {
  readonly repo: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export const CATALOG_FILES: Readonly<
  Record<string, Readonly<Record<string, readonly CatalogFile[]>>>
> = {
  "qwen3-coder-next": {
    Q5_K_M: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_M/Qwen3-Coder-Next-Q5_K_M-00001-of-00003.gguf",
        bytes: 5936320,
        sha256: "183e233cc93de594cf343d914bb2ba21f7ae252ac4699b52b83c1200327f4b11",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_M/Qwen3-Coder-Next-Q5_K_M-00002-of-00003.gguf",
        bytes: 49604927264,
        sha256: "bcfc3c900a2b6ed0d7d5c51397edd55261a0562a1ce64b62204c4576c3ecafd0",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_M/Qwen3-Coder-Next-Q5_K_M-00003-of-00003.gguf",
        bytes: 7237023104,
        sha256: "9b49c5c452924ca3b0864c6a32b3e5ebd14d6a063c5a89c976947347ed9a802c",
      },
    ],
    Q5_K_S: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_S/Qwen3-Coder-Next-Q5_K_S-00001-of-00003.gguf",
        bytes: 5936320,
        sha256: "85b3695c221fe4716b5d1397da1db7643d44dc697e03513b35c6a36aca479683",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_S/Qwen3-Coder-Next-Q5_K_S-00002-of-00003.gguf",
        bytes: 49756868608,
        sha256: "cdd131e37d7d656897004f434ced764c230cfc962232328ab907c4e6f3d4d1e2",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q5_K_S/Qwen3-Coder-Next-Q5_K_S-00003-of-00003.gguf",
        bytes: 5292475552,
        sha256: "086f85116ece1e651a21f937268987214a9504dd5320842f6d450f765ba9c11f",
      },
    ],
    Q6_K: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q6_K/Qwen3-Coder-Next-Q6_K-00001-of-00003.gguf",
        bytes: 5936320,
        sha256: "b29fc953bb49f2f7857a7112dbe32dc17b7842c9afeaa4895a431437c692df50",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q6_K/Qwen3-Coder-Next-Q6_K-00002-of-00003.gguf",
        bytes: 49795838592,
        sha256: "f28f4a3579b187ff5b2b67ae12cd7e060733775a6ccc9f2f8b59c3c17645b84b",
      },
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Q6_K/Qwen3-Coder-Next-Q6_K-00003-of-00003.gguf",
        bytes: 15812217376,
        sha256: "4b08b8b13480d9ae269e77c09931dfbe45b8d002836da979d6b9078d0786ba61",
      },
    ],
    IQ4_XS: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-IQ4_XS.gguf",
        bytes: 42676135968,
        sha256: "9039c9ebc67360f8760f32c8c72f800a74454b17c3fa287c0e2f34a55794e463",
      },
    ],
    Q2_K: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-Q2_K.gguf",
        bytes: 29224450080,
        sha256: "2ac738bc947bc3470e37962c2ee0ab390fa953740e9873575695276980abad87",
      },
    ],
    Q3_K_M: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-Q3_K_M.gguf",
        bytes: 38322487328,
        sha256: "b12ec74934e548b3e9cb80d05660a9a6a5af1a2aec6fbf5f9e9b4a36626aee75",
      },
    ],
    Q3_K_S: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-Q3_K_S.gguf",
        bytes: 34603089952,
        sha256: "0b076707e566e68fc8e307ff2a14cd2cfa7822e60467da31793e22c0cdc9e70c",
      },
    ],
    Q4_K_M: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-Q4_K_M.gguf",
        bytes: 48528320544,
        sha256: "9e6032d2f3b50a60f17ce8bf5a1d85c71af9b53b89c7978020ae7c660f29b090",
      },
    ],
    Q4_K_S: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-Q4_K_S.gguf",
        bytes: 45531949088,
        sha256: "95e490ddf8d25eb911557ee1f4604ab7207e43f00a2bcf16223040ca0484cdb5",
      },
    ],
    IQ1_S: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-UD-IQ1_S.gguf",
        bytes: 21508749344,
        sha256: "98c98964d9dbc8aaba3153abe2aca35f6202a867e9e3ba2568b982621815d4ce",
      },
    ],
    IQ2_M: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-UD-IQ2_M.gguf",
        bytes: 24962293760,
        sha256: "f9d82aaa687a1c50734c0e679e06fe8f6fa175b05676a9069eba633342d2d876",
      },
    ],
    IQ2_XXS: [
      {
        repo: "unsloth/Qwen3-Coder-Next-GGUF",
        file: "Qwen3-Coder-Next-UD-IQ2_XXS.gguf",
        bytes: 23312490496,
        sha256: "3d1e6849cce81818e39298da4a0405c1794e9058dd942a7722ffeaba208963f7",
      },
    ],
  },
  "qwen3.6-27b": {
    IQ4_XS: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-IQ4_XS.gguf",
        bytes: 15440005344,
        sha256: "8a3365759dc1b33b52c4e7d91d5a67d5ee1418e8408aa54196f04a98da53e5dc",
      },
    ],
    Q3_K_M: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q3_K_M.gguf",
        bytes: 13586217184,
        sha256: "bdfa99d488b501f5ca711f35c930f005319a064eabcaae23290571a25c499eeb",
      },
    ],
    Q3_K_S: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q3_K_S.gguf",
        bytes: 12358727904,
        sha256: "4afb4abcf0207a484b0d7e92c0421b74e8ce1c7a7250bb9d824b79288da68f20",
      },
    ],
    Q4_K_M: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q4_K_M.gguf",
        bytes: 16817244384,
        sha256: "5ed60d0af4650a854b1755bd392f9aef4872643dc25a254bc68043fa638392a0",
      },
    ],
    Q4_K_S: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q4_K_S.gguf",
        bytes: 15856158944,
        sha256: "ff857ba9f2184d8be408e8cabda12c89ba5adb202fddc1a88b3774d7bb232aca",
      },
    ],
    Q5_K_M: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q5_K_M.gguf",
        bytes: 19509790944,
        sha256: "cfecab168156269f25d5ffe9e13cf2a401ca2f43a9693fa00bcd1625316ccbde",
      },
    ],
    Q5_K_S: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q5_K_S.gguf",
        bytes: 18958305504,
        sha256: "a514ac5864d1d35841bd0bed4fdcb8e81360b5224586c3634ecca0e5de886579",
      },
    ],
    Q6_K: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-Q6_K.gguf",
        bytes: 22523238624,
        sha256: "ec1805fe87e6519c461c1ed2d179865464a875ed241032ead65a354f979cfe14",
      },
    ],
    IQ2_M: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-UD-IQ2_M.gguf",
        bytes: 10846136544,
        sha256: "24dfb0786e3b6b32e16082816a8245f4cf2fbaea71345062943c4323763ce5c6",
      },
    ],
    IQ2_XXS: [
      {
        repo: "unsloth/Qwen3.6-27B-GGUF",
        file: "Qwen3.6-27B-UD-IQ2_XXS.gguf",
        bytes: 9388779744,
        sha256: "968bfc712832031afebec339da3ae61c6822ab9a118e1d72b6be2a7781a96e30",
      },
    ],
  },
  "qwen3.6-35b-a3b": {
    IQ2_M: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-IQ2_M.gguf",
        bytes: 11522702304,
        sha256: "2be7ef1ed7e1af8b10d3829102cf9a6c2bd5ddb64d675b4ece23a60799403d43",
      },
    ],
    IQ2_XXS: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-IQ2_XXS.gguf",
        bytes: 10756586464,
        sha256: "2e8f5f705355c56311432d0a8a5d14a696dbb7e4b197d05c75ba805fc1857bef",
      },
    ],
    IQ4_XS: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-IQ4_XS.gguf",
        bytes: 17730509792,
        sha256: "649d7508507b84638732c4f52c24c8b15843c6dca2f3ff793ae07c14a67ebbb3",
      },
    ],
    Q3_K_M: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q3_K_M.gguf",
        bytes: 16600710112,
        sha256: "1b715841683f960bd9a49f008181bd910ee169b78d4cf465b6fde7f4d929ff99",
      },
    ],
    Q3_K_S: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q3_K_S.gguf",
        bytes: 15359196128,
        sha256: "212ccdf37d416167ce8dcd7e3a59bcd45b30ac7531822a1e7bb79bfbacb2d1aa",
      },
    ],
    Q4_K_M: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
        bytes: 22134528992,
        sha256: "ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61",
      },
    ],
    Q4_K_S: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q4_K_S.gguf",
        bytes: 20893015008,
        sha256: "a8138f183e3993f12cdc23afd2babb8cdb084e64088ce4a256d49101d47b949c",
      },
    ],
    Q5_K_M: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q5_K_M.gguf",
        bytes: 26456194016,
        sha256: "c13ce26253ea334df472bd8fbd2d6da66d8a41195c17f6fcbf44c4d20ece0932",
      },
    ],
    Q5_K_S: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q5_K_S.gguf",
        bytes: 24942050272,
        sha256: "31d886cbd8c3db2e66f4366cbfed93389cb982bdced1caa37262befdb34f5715",
      },
    ],
    Q6_K: [
      {
        repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
        file: "Qwen3.6-35B-A3B-UD-Q6_K.gguf",
        bytes: 29308320736,
        sha256: "4fe53b148b46f9b88830e2a3055c5b15c3a4d1e3ddc9a1384a108d8b9d59f043",
      },
    ],
  },
  "gpt-oss-20b": {
    MXFP4: [
      {
        repo: "ggml-org/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-MXFP4.gguf",
        bytes: 12109566624,
        sha256: "27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901",
      },
    ],
    Q2_K: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q2_K.gguf",
        bytes: 11468317888,
        sha256: "129b8e3865517cbba55bbb7d4f0cc2444a014e73a619eafbac247ef6573a19ee",
      },
    ],
    Q3_K_M: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q3_K_M.gguf",
        bytes: 11506103488,
        sha256: "bc02b57e05cfef36b1f6f4a952666a76b26838f8cf431412cb0cd19f41cf8040",
      },
    ],
    Q3_K_S: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q3_K_S.gguf",
        bytes: 11463894208,
        sha256: "8deacd2c5ed46d1a62368c52e44abdb55e32a2aa0e5acea86d18d8258339f17d",
      },
    ],
    Q4_K_M: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q4_K_M.gguf",
        bytes: 11624759488,
        sha256: "c27536640e410032865dc68781d80a08b98f8db5e93575919af8ccc0568aeb4f",
      },
    ],
    Q4_K_S: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q4_K_S.gguf",
        bytes: 11618492608,
        sha256: "3c5483e8749f4865f1aae2c36b796e7b8c43ec02c5a74d663a82a5fe916b2298",
      },
    ],
    Q5_K_M: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q5_K_M.gguf",
        bytes: 11717357248,
        sha256: "9c3814533c5b4c84d42b5dce4376bbdfd7227e990b8733a3a1c4f741355b3e75",
      },
    ],
    Q5_K_S: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q5_K_S.gguf",
        bytes: 11711827648,
        sha256: "b9a5c5312dcf63af3ab5a2a2aed6e3bc86d51d452bce364ff44f573a8b089141",
      },
    ],
    Q6_K: [
      {
        repo: "unsloth/gpt-oss-20b-GGUF",
        file: "gpt-oss-20b-Q6_K.gguf",
        bytes: 12041000128,
        sha256: "f2ead52a7842a556ea10d5edd91a88e5af974856d2485ecaad3aade679832935",
      },
    ],
  },
  "qwen3.5-9b": {
    IQ4_XS: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-IQ4_XS.gguf",
        bytes: 5168653536,
        sha256: "7e918aeca06c52bcb528ea6b04b4ec957e75ee8c0a73138854c0dfcf371ea429",
      },
    ],
    Q3_K_M: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q3_K_M.gguf",
        bytes: 4673643744,
        sha256: "8fed90306e4f019e2bf35f3766470b7bc59ea1a9dae00f5ceb20b43cb5514393",
      },
    ],
    Q3_K_S: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q3_K_S.gguf",
        bytes: 4316865760,
        sha256: "162050d39ebae6b8a87435f282bcb7a0e3fab7b2444db730966b3fef1ed0179e",
      },
    ],
    Q4_K_M: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q4_K_M.gguf",
        bytes: 5680522464,
        sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
      },
    ],
    Q4_K_S: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q4_K_S.gguf",
        bytes: 5394097376,
        sha256: "023713a5240bf58a84d2890a30deb2e0485abb5b9b9c33ba67596e9248b35f80",
      },
    ],
    Q5_K_M: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q5_K_M.gguf",
        bytes: 6577841376,
        sha256: "dc2a39aef291f91a9116ad214058da0d86eb648743a124bd8c333787c4b9c91c",
      },
    ],
    Q5_K_S: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q5_K_S.gguf",
        bytes: 6361146592,
        sha256: "be88613a50ba792bd5a2bc07b74bcd97c9ed9dbac028d27a44c6888e712323c3",
      },
    ],
    Q6_K: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-Q6_K.gguf",
        bytes: 7458301152,
        sha256: "91898433cf5ce0a8f45516a4cc3e9343b6e01d052d01f684309098c66a326c59",
      },
    ],
    IQ2_M: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-UD-IQ2_M.gguf",
        bytes: 3649365216,
        sha256: "a31b6b4c603ddd66b5496ee065c9dd13b2b6de77dce9e5d59609aef8d39868e7",
      },
    ],
    IQ2_XXS: [
      {
        repo: "unsloth/Qwen3.5-9B-GGUF",
        file: "Qwen3.5-9B-UD-IQ2_XXS.gguf",
        bytes: 3190613216,
        sha256: "570ce2bbc92545cffbcb01df43cba59d86093dadc34c25da9f554d256bc70b91",
      },
    ],
  },
  "minicpm5-2b": {
    Q4_K_M: [
      {
        repo: "openbmb/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q4_K_M.gguf",
        bytes: 1561318368,
        sha256: "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd",
      },
    ],
    IQ2_M: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-IQ2_M.gguf",
        bytes: 969755872,
        sha256: "226910fb185d2144c0104caec610b8153c1f8a02a9b7b0786c2403a7eaedfc89",
      },
    ],
    IQ3_M: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-IQ3_M.gguf",
        bytes: 1362734304,
        sha256: "d8449ca826ae6069cb2ce27d848fb5c4e2c5432ccfb48563c279b3cd0e7729f2",
      },
    ],
    IQ4_XS: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-IQ4_XS.gguf",
        bytes: 1463942368,
        sha256: "5fb17322eee91152bd4279cb95577652c2bf5c0cc367318f47a8c3a86b15146d",
      },
    ],
    Q2_K: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q2_K.gguf",
        bytes: 1014320352,
        sha256: "04ed732d753dbcc4219acfbc4b17063d0576b2b2c0840bcdab996461fbf985e1",
      },
    ],
    Q3_K_M: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q3_K_M.gguf",
        bytes: 1236085984,
        sha256: "db666cbdcd541207eba953bb3791e448e37502e79188c292aafde86934ff9993",
      },
    ],
    Q3_K_S: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q3_K_S.gguf",
        bytes: 1189694688,
        sha256: "a5623db01cd4d96c705d4a1b2c34fd598b4745df2408d5ed94fe3cae8ea4d857",
      },
    ],
    Q4_K_S: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q4_K_S.gguf",
        bytes: 1534004448,
        sha256: "2588c13c110b78da40f2ece9cfb0fe3d190116752eb1b169e0f5052d0fddd2a1",
      },
    ],
    Q5_K_M: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q5_K_M.gguf",
        bytes: 1920175328,
        sha256: "c32c4e0203ac181f5771291725a76dfd94bdc6c54ee79fcb17ebaea3c19c500b",
      },
    ],
    Q5_K_S: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q5_K_S.gguf",
        bytes: 1816530144,
        sha256: "e2685c3c0012d2e9369205ce97e23cec52fc26fec2b21246a9ca445d77f4e067",
      },
    ],
    Q6_K: [
      {
        repo: "bartowski/MiniCPM5-2B-GGUF",
        file: "MiniCPM5-2B-Q6_K.gguf",
        bytes: 2107305184,
        sha256: "c9f424852aa737b3f5f2f83096a6214d86a8ea2516f3a0fbaa04a3b4feba477d",
      },
    ],
  },
};
