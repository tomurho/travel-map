# Catalog decisions — approved and applied

The owner approved and applied the seven proposed merges. 鮨安 remains a Taipei day trip. Two uncertain venue pairs remain separate. The original proposal JSON is preserved as evidence; approved-merges.json records the executed changes.

| Group | Current records | Proposed change | Editorial choice |
|---|---|---|---|
| `ChIJKa5zWIMIAWARkLzRgMFz_Go` | `bar-k-297`: Bar K家 (been, Loved=False, Bar); `bar-k-main-building-103`: Bar K家 (Main Building) (been, Loved=True, Bar) | Retain `bar-k-main-building-103`; archive the replaced ID using the proposed mapping | loved: [False, True]; name: ['Bar K家', 'Bar K家 (Main Building)'] |
| `ChIJvxV_Q5AIAWARDi0ttHJ1MKM` | `120`: 大極殿本舗 六角店 (location, Loved=None, Desserts); `120-2`: 栖園 （せいえん) (location, Loved=None, Desserts) | Keep both pending venue identity confirmation | name: ['大極殿本舗 六角店', '栖園 （せいえん)'] |
| `ChIJCfjEouIJAWARTnEricoddZc` | `bunshitsu-ikehan-143-11`: 池半 (Bunshitsu ikehan) (want_to_go, Loved=None, Tea house); `ikehan-tea-299`: 茶室 Ikehan (tea) (location, Loved=None, Tea house) | Retain `bunshitsu-ikehan-143-11`; archive the replaced ID using the proposed mapping | district: ['Shimogyo Ward', 'Nakagyo Ward']; name: ['池半 (Bunshitsu ikehan)', '茶室 Ikehan (tea)']; status: ['want_to_go', 'location'] |
| `ChIJoYR-zZwFVzURfF2jNlX5pOc` | `place_matsue_saeki`: Saeki (been, Loved=True, Restaurant); `place_matsue_unknown_place`: Saeki (want_to_go, Loved=False, Restaurant) | Retain `place_matsue_saeki`; archive the replaced ID using the proposed mapping | loved: [True, False]; status: ['been', 'want_to_go'] |
| `ChIJP1Ftx1-pQjQRj1jxNrNocNM` | `no-20-lane-11-taiyuan-rd-datong-district-taipei-city-103`: 光生 (location, Loved=None, Coffee); `place_taipei_mitsuo_coffee`: 光生 MITSUO (location, Loved=None, Café) | Retain `place_taipei_mitsuo_coffee`; archive the replaced ID using the proposed mapping | category: ['Coffee', 'Café']; name: ['光生', '光生 MITSUO'] |
| `ChIJD7h_kgKrQjQRZD0m5LSv70k` | `no-36-1-songde-rd-xinyi-district-taipei-city-110`: 小隱茶庵 信義店 (location, Loved=None, Tea house); `kino-1f-no-8-alley-14-lane-150-section-5-xinyi-rd-xinyi-district-taipei-city-110`: 木下庵 Kino (location, Loved=None, Tea house) | Keep both pending venue identity confirmation | name: ['小隱茶庵 信義店', '木下庵 Kino'] |
| `ChIJ5e8BNgCrQjQR_ftkevAjUZQ` | `no-1-lane-14-siwei-rd-daan-district-taipei-city-taiwan-106`: 廟東 食肆 (want_to_go, Loved=None, Wine bar); `place_taipei_miaodong`: 廟東 食肆 (location, Loved=None, Wine bar) | Retain `place_taipei_miaodong`; archive the replaced ID using the proposed mapping | status: ['want_to_go', 'location'] |
| `ChIJ_Qw_QQCNGGARIqcxkPIzWbI` | `chiune-1-3-3f`: CHIUnE (location, Loved=None, Fusion); `chiune-1-22-12`: チウネ (CHIUnE) (location, Loved=None, Fusion) | Retain `chiune-1-3-3f`; archive the replaced ID using the proposed mapping | district: ['Chiyoda', 'Chuo']; name: ['CHIUnE', 'チウネ (CHIUnE)'] |
| `ChIJ8fbyNgCLGGAR5P-fltwTkzk` | `place_tokyo_edoyakiniku`: 江戸焼肉 (want_to_go, Loved=None, Restaurant); `edo-yakiniku-6-6-5-hulic-new-ginza-namiki-6-4f-b`: 江戸焼肉 (Edo Yakiniku) (want_to_go, Loved=None, Yakiniku) | Retain `edo-yakiniku-6-6-5-hulic-new-ginza-namiki-6-4f-b`; archive the replaced ID using the proposed mapping | category: ['Restaurant', 'Yakiniku']; name: ['江戸焼肉', '江戸焼肉 (Edo Yakiniku)'] |

For Saeki and Bar K家, the proposal keeps Loved/Been. For Ikehan and 廟東 食肆, it keeps Want to go. These approved values are now applied.

For CHIUnE, the retained address and proposed district are Chiyoda. For Edo Yakiniku, the proposed category is Yakiniku. For MITSUO, it is Café. The complete JSON preserves each old value.

## Taipei outlier

Decision: keep `鮨安` in Taipei as a day trip. Its coordinates and address are unchanged. The public note says “Day trip from Taipei: Zhubei, Hsinchu.” The initial Hsinchu proposal was not applied.

## Safe corrections applied

Filled 59 blank districts from exact district text in existing addresses: 54 Tainan and five Kaohsiung. No names, ratings, statuses, coordinates, or IDs changed. See `district-changes.json` for every address and change. Matsue, Nagasaki, and remaining gaps stay blank because no district was stated.

The merge checked every source record against its reviewed version and used the atomic writer with a fresh backup. src/data/place-id-aliases.json contains the seven retained-ID mappings. Publish and Sync reject retired IDs with repair guidance, so an old Sheet row cannot restore the removed duplicate. No live Sheet row was changed. Two differently named pairs remain flagged for identity review; no automatic identity claim was made.
