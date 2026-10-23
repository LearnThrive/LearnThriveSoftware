# Ollama three-model benchmark: measured numbers

Run 2026-10-23T14:24:06.951Z to 2026-10-23T14:24:32.848Z.
Machine: AMD Ryzen 7 5800H with Radeon Graphics         , 16 CPUs, 63 GiB RAM; GPU NVIDIA GeForce RTX 3070 Laptop GPU, 8192, 617.42.
Quality-only run: the exact-answer set, 3 run(s) per question; no timings and no helper roles.

## qwen3.5:9b

Digest `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`, 6.10 GiB, Q4_K_M, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Exact-answer quality set: 18/18 (3 run(s) per question; automatic content check).

- fraction of a number: 3/3
- linear equation: 3/3
- percentage: 3/3
- index laws: 3/3
- nth term: 3/3
- factorise: 3/3

## bonsai-2:9b

Digest `c8b5462f8688647fe0b53568e3c00181ada5f05300aa4bf00695f2902f4d388e`, 2.96 GiB, Q2_0, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Exact-answer quality set: 18/18 (3 run(s) per question; automatic content check).

- fraction of a number: 3/3
- linear equation: 3/3
- percentage: 3/3
- index laws: 3/3
- nth term: 3/3
- factorise: 3/3

## bonsai-2:4b

Digest `93edd652c9326fb1e782c1f54e997ce6a46e2351c763777db0c63b8a51cf6bec`, 1.47 GiB, Q2_0, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Exact-answer quality set: 16/18 (3 run(s) per question; automatic content check).

- fraction of a number: 3/3
- linear equation: 1/3
- percentage: 3/3
- index laws: 3/3
- nth term: 3/3
- factorise: 3/3

## Embeddings and typed decisions

Not measured in a quality-only run (`--quality-only`).

