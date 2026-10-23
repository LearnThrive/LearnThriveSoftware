# Ollama three-model benchmark: measured numbers

Run 2026-10-23T11:55:58.469Z to 2026-10-23T12:02:25.844Z.
Machine: AMD Ryzen 7 5800H with Radeon Graphics         , 16 CPUs, 63 GiB RAM; GPU NVIDIA GeForce RTX 3070 Laptop GPU, 8192, 617.42.
Context 4096, keep_alive 30m. Warm runs per interactive case: 10 text, 5 photo, 3 thinking. Percentiles from small samples are estimates and are labelled with their count.

## qwen3.5:9b

Digest `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`, 6.10 GiB, Q4_K_M, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Cold load (evicted first, count 1): 8521 ms wall, server load 8429 ms. VRAM at load 5347 MiB.

| Case | n | errors | first answer ms (median / p90 / max) | total ms (median) | tok/s (median) | VRAM used peak / free min MiB |
| --- | --- | --- | --- | --- | --- | --- |
| warm text: a short explanation | 10 | 0 | 108.8 / 229.6 / 15263.9 | 1239.9 | 53.1 | 7807 / 212 |
| warm text: solve 2x + 7 = 19 | 10 | 0 | 93.8 / 143.9 / 214.9 | 1206.7 | 53.8 | 7807 / 212 |
| photo: worked arithmetic answer | 5 | 0 | 6830.5 / 6982.7 / 6982.7 | 8117.9 | 52.7 | 7866 / 153 |
| photo: diagram and table | 5 | 0 | 8767.5 / 8837 / 8837 | 9636.2 | 55.8 | 7870 / 149 |
| photo: rotated, superscripts and roots | 5 | 0 | 86.6 / 6877.6 / 6877.6 | 1382.1 | 55.6 | 7870 / 149 |
| photo follow-up: check step 2 | 5 | 0 | 85.6 / 6899.6 / 6899.6 | 1627.4 | 55.1 | 7870 / 149 |
| thinking: hard multi-step proof | 3 | 0 | - | 13000.1 | 54.5 | 7872 / 147 |
| tool: a real allowed call (check_calculation) | 3 | 0 | 3 tool request(s), 3 completed | | | |
| tool: a disallowed call is refused | 1 | 0 | unknown_tool | | | |
| cancel: stop after the first token | 1 | 0 | aborted | | | |
| two requests at once | 2 | 0 | see JSON | | | |
| missing model | 1 | 0 | bad_request | | | |
| embedding helper unreachable | 1 | 0 | unavailable | | | |

## bonsai-2:9b

Digest `c8b5462f8688647fe0b53568e3c00181ada5f05300aa4bf00695f2902f4d388e`, 2.96 GiB, Q2_0, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Cold load (evicted first, count 1): 7380 ms wall, server load 7291 ms. VRAM at load 2689 MiB.

| Case | n | errors | first answer ms (median / p90 / max) | total ms (median) | tok/s (median) | VRAM used peak / free min MiB |
| --- | --- | --- | --- | --- | --- | --- |
| warm text: a short explanation | 10 | 0 | 84.3 / 85.4 / 189.3 | 791.4 | 86.5 | 5198 / 2821 |
| warm text: solve 2x + 7 = 19 | 10 | 0 | 88.1 / 120 / 128.5 | 980.7 | 85.7 | 5198 / 2821 |
| photo: worked arithmetic answer | 5 | 0 | 936.2 / 1011 / 1011 | 1613.3 | 85.5 | 5258 / 2761 |
| photo: diagram and table | 5 | 0 | 1145.9 / 1164.8 / 1164.8 | 1329.2 | 85 | 5264 / 2755 |
| photo: rotated, superscripts and roots | 5 | 0 | 85.9 / 974.5 / 974.5 | 2569.1 | 83.7 | 5264 / 2755 |
| photo follow-up: check step 2 | 5 | 0 | 91.3 / 973.2 / 973.2 | 859.2 | 85.4 | 5264 / 2755 |
| thinking: hard multi-step proof | 3 | 0 | - | 8310.5 | 85.6 | 5264 / 2755 |
| tool: a real allowed call (check_calculation) | 3 | 0 | 3 tool request(s), 3 completed | | | |
| tool: a disallowed call is refused | 1 | 0 | unknown_tool | | | |
| cancel: stop after the first token | 1 | 0 | aborted | | | |
| two requests at once | 2 | 0 | see JSON | | | |
| missing model | 1 | 0 | bad_request | | | |
| embedding helper unreachable | 1 | 0 | unavailable | | | |

## bonsai-2:4b

Digest `93edd652c9326fb1e782c1f54e997ce6a46e2351c763777db0c63b8a51cf6bec`, 1.47 GiB, Q2_0, context requested 4096. Capabilities: vision=true, toolUse=true, thinking=true.

Cold load (evicted first, count 1): 8314 ms wall, server load 8189 ms. VRAM at load 1630 MiB.

| Case | n | errors | first answer ms (median / p90 / max) | total ms (median) | tok/s (median) | VRAM used peak / free min MiB |
| --- | --- | --- | --- | --- | --- | --- |
| warm text: a short explanation | 10 | 0 | 60.1 / 111.2 / 248.1 | 534.9 | 120.5 | 3826 / 4193 |
| warm text: solve 2x + 7 = 19 | 10 | 0 | 85.3 / 90.7 / 90.8 | 759.4 | 123.9 | 3826 / 4193 |
| photo: worked arithmetic answer | 5 | 0 | 575.3 / 15677.6 / 15677.6 | 1129.1 | 119.4 | 3860 / 4159 |
| photo: diagram and table | 5 | 0 | 618.5 / 690 / 690 | 756.9 | 116.1 | 3864 / 4155 |
| photo: rotated, superscripts and roots | 5 | 0 | 75.7 / 543.3 / 543.3 | 685 | 125.8 | 3864 / 4155 |
| photo follow-up: check step 2 | 5 | 0 | 77.7 / 557.7 / 557.7 | 590.5 | 121.4 | 3864 / 4155 |
| thinking: hard multi-step proof | 3 | 0 | - | 5703.6 | 124.6 | 3864 / 4155 |
| tool: a real allowed call (check_calculation) | 3 | 0 | 3 tool request(s), 3 completed | | | |
| tool: a disallowed call is refused | 1 | 0 | unknown_tool | | | |
| cancel: stop after the first token | 1 | 0 | aborted | | | |
| two requests at once | 2 | 0 | see JSON | | | |
| missing model | 1 | 0 | bad_request | | | |
| embedding helper unreachable | 1 | 0 | unavailable | | | |

## Embeddings and retrieval

Model `embeddinggemma-2:270m-q8_0-text`, dimension 768. Indexed 8 chunks in 7691 ms; query embedding median 19.5 ms (n=6). Retrieval hit@1 6/6, hit@4 6/6.

## Typed decisions

Model `laya:421m-typed-decisions-bf16`: 3/3 answered correctly (9 abstained of 12); latency median 29.2 ms.

