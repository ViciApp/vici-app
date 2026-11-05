// Flow Mode generative-artwork palettes — six categories × theme ×
// state. Pure colour data consumed by `renderFlowArt`; extracted from
// `flow-art.utils.ts` to keep the renderer module readable.

import type {
	FlowArtBucket,
	FlowArtPalette,
	FlowArtState,
	FlowArtTheme
} from '#lib/utils/flow-art/types.ts';

type CategoryPalettes = Record<FlowArtState, FlowArtPalette>;
type ThemePalettes = Record<FlowArtTheme, Partial<CategoryPalettes> & { neutral: FlowArtPalette }>;

export const PAL: Record<FlowArtBucket | 'wc', ThemePalettes> = {
	macro: {
		dark: {
			neutral: {
				bg: '#0E1422',
				base: '#1B2742',
				ink: '#2D3E66',
				accent: '#E2B842',
				hot: '#7EB6FF',
				dim: '#3A4C70',
				fg: '#F2ECDC'
			},
			won: {
				bg: '#15203A',
				base: '#23355E',
				ink: '#3C5793',
				accent: '#FFD06A',
				hot: '#A8CFFF',
				dim: '#5A78B5',
				fg: '#FFF6E1'
			},
			lost: {
				bg: '#10131A',
				base: '#1C212B',
				ink: '#2C3340',
				accent: '#6E6A5C',
				hot: '#4A5366',
				dim: '#22272F',
				fg: '#9C9890'
			}
		},
		light: {
			neutral: {
				bg: '#F2ECDC',
				base: '#E2D8BA',
				ink: '#3D5A85',
				accent: '#B68B1F',
				hot: '#2A6FDB',
				dim: '#B5C0D2',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FFE5D0',
				base: '#F4C0A8',
				ink: '#8C3E50',
				accent: '#B68B1F',
				hot: '#D14B72',
				dim: '#C99080',
				fg: '#3D2419'
			}
		}
	},
	crypto: {
		dark: {
			neutral: {
				bg: '#0A0A12',
				base: '#1A0E2E',
				ink: '#3D1F66',
				accent: '#6FFFB3',
				hot: '#A86FFF',
				dim: '#0E1224',
				fg: '#F2ECDC'
			},
			won: {
				bg: '#0C1018',
				base: '#1E1338',
				ink: '#5430A0',
				accent: '#92FFC8',
				hot: '#C99CFF',
				dim: '#16193A',
				fg: '#F4FFE7'
			},
			lost: {
				bg: '#0D0D11',
				base: '#1A1A20',
				ink: '#2A2A33',
				accent: '#4F4F58',
				hot: '#3D3D45',
				dim: '#15151A',
				fg: '#888A8E'
			}
		},
		light: {
			neutral: {
				bg: '#EFEAE0',
				base: '#DBD0B8',
				ink: '#5A2E94',
				accent: '#2BA178',
				hot: '#7A4FB8',
				dim: '#C5B6D6',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FBDDD9',
				base: '#F0B8B2',
				ink: '#6A2F70',
				accent: '#1E8C68',
				hot: '#A0589E',
				dim: '#C99592',
				fg: '#3D2419'
			}
		}
	},
	sports: {
		dark: {
			neutral: {
				bg: '#1A0F0B',
				base: '#3A1A0F',
				ink: '#9F2A1A',
				accent: '#FF6B2C',
				hot: '#FFB066',
				dim: '#5A2418',
				fg: '#FAEEDB'
			},
			won: {
				bg: '#241510',
				base: '#5C2415',
				ink: '#D43820',
				accent: '#FF8744',
				hot: '#FFCE85',
				dim: '#8B3624',
				fg: '#FFF4DD'
			},
			lost: {
				bg: '#16110E',
				base: '#2B221E',
				ink: '#3F342E',
				accent: '#7A6453',
				hot: '#5C4E43',
				dim: '#352A24',
				fg: '#A89E92'
			}
		},
		light: {
			neutral: {
				bg: '#F8EBD7',
				base: '#EDD7B0',
				ink: '#B5462C',
				accent: '#D04F1A',
				hot: '#FF8744',
				dim: '#DBAA8C',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FFDDC4',
				base: '#F4B58A',
				ink: '#9F3520',
				accent: '#C04014',
				hot: '#FF6E2F',
				dim: '#D69875',
				fg: '#3D2419'
			}
		}
	},
	politics: {
		dark: {
			neutral: {
				bg: '#0E1426',
				base: '#1E2C4D',
				ink: '#345285',
				accent: '#F2ECDC',
				hot: '#6F1C20',
				dim: '#2A3A60',
				fg: '#F2ECDC'
			},
			won: {
				bg: '#14213D',
				base: '#28406B',
				ink: '#4F73AB',
				accent: '#FFE1A8',
				hot: '#A6332E',
				dim: '#3B548C',
				fg: '#FFF8E1'
			},
			lost: {
				bg: '#0E1018',
				base: '#1B1F2A',
				ink: '#2C313E',
				accent: '#A4A096',
				hot: '#3D2A2C',
				dim: '#22262F',
				fg: '#9B978D'
			}
		},
		light: {
			neutral: {
				bg: '#F2ECDC',
				base: '#E2D8BA',
				ink: '#2D4570',
				accent: '#6F1C20',
				hot: '#1D365C',
				dim: '#B5C0D2',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FFE0D5',
				base: '#F4BCAC',
				ink: '#642B57',
				accent: '#8E2F50',
				hot: '#522074',
				dim: '#D2918E',
				fg: '#3D2419'
			}
		}
	},
	tech: {
		dark: {
			neutral: {
				bg: '#0E1116',
				base: '#1F242B',
				ink: '#3E4854',
				accent: '#4D8BFF',
				hot: '#ECF1F8',
				dim: '#262B33',
				fg: '#ECF1F8'
			},
			won: {
				bg: '#101620',
				base: '#1F2A3C',
				ink: '#3D5072',
				accent: '#6FA5FF',
				hot: '#FFFFFF',
				dim: '#2A3344',
				fg: '#FFFFFF'
			},
			lost: {
				bg: '#0D0F12',
				base: '#191C21',
				ink: '#2A2D32',
				accent: '#454953',
				hot: '#5E626A',
				dim: '#1E2126',
				fg: '#94989F'
			}
		},
		light: {
			neutral: {
				bg: '#EDEDE6',
				base: '#DCDBD3',
				ink: '#2D3B4D',
				accent: '#2A6FDB',
				hot: '#0E0D0B',
				dim: '#B0B8C2',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FCE2D5',
				base: '#F2BFAA',
				ink: '#4F2F70',
				accent: '#7A48B8',
				hot: '#9070D6',
				dim: '#C8A5A8',
				fg: '#3D2419'
			}
		}
	},
	culture: {
		dark: {
			neutral: {
				bg: '#16110C',
				base: '#2A1F18',
				ink: '#6F4E2F',
				accent: '#E2B842',
				hot: '#C24A3D',
				dim: '#3B2C20',
				fg: '#F2ECDC',
				inks: ['#E2B842', '#C24A3D', '#7EB6FF', '#B49CFF', '#6FE0B6', '#FF8A4C']
			},
			won: {
				bg: '#1C160F',
				base: '#34281D',
				ink: '#8C6238',
				accent: '#FFD06A',
				hot: '#E25A47',
				dim: '#4D3A29',
				fg: '#FFF6E1',
				inks: ['#FFD06A', '#E25A47', '#A8CFFF', '#C99CFF', '#92FFC8', '#FFB066']
			},
			lost: {
				bg: '#12100D',
				base: '#1F1B16',
				ink: '#3B342B',
				accent: '#7C7368',
				hot: '#5C5249',
				dim: '#28241E',
				fg: '#A29C92',
				inks: ['#7C7368', '#5C5249', '#6E6A5C', '#928876', '#827870', '#A29C92']
			}
		},
		light: {
			neutral: {
				bg: '#F5EBD2',
				base: '#E8D9B0',
				ink: '#7A4A1F',
				accent: '#B68B1F',
				hot: '#B5462C',
				dim: '#C9B589',
				fg: '#0E0D0B',
				inks: ['#B68B1F', '#B5462C', '#2A6FDB', '#7A4FB8', '#2BA178', '#D04F1A']
			}
		},
		peach: {
			neutral: {
				bg: '#FFE5CC',
				base: '#F4BC95',
				ink: '#7C3D2C',
				accent: '#B68B1F',
				hot: '#C73D60',
				dim: '#D6A87E',
				fg: '#3D2419',
				inks: ['#B68B1F', '#C73D60', '#7A48B8', '#C04014', '#642B57', '#7C3D2C']
			}
		}
	},
	// World Cup — pitch green base with chalk-line architecture + gold
	// accent. Tentpole-only: emitted exclusively when a market belongs
	// to the active FeaturedEvent (see `FLOW_ART_CATEGORIES`, which
	// excludes `wc` so the random fallback never selects it).
	wc: {
		dark: {
			neutral: {
				bg: '#0E2A1A',
				base: '#143A24',
				ink: '#2A6A42',
				accent: '#E2B842',
				hot: '#F2ECDC',
				dim: '#1E4A30',
				fg: '#F2ECDC'
			},
			won: {
				bg: '#143F26',
				base: '#1B5532',
				ink: '#3B8A56',
				accent: '#FFD06A',
				hot: '#FFFFFF',
				dim: '#266A40',
				fg: '#FFF6E1'
			},
			lost: {
				bg: '#10231A',
				base: '#1A2E22',
				ink: '#2A3D30',
				accent: '#7C7368',
				hot: '#5C5249',
				dim: '#1C2A22',
				fg: '#9C9890'
			}
		},
		light: {
			neutral: {
				bg: '#E8F0DC',
				base: '#D2E0BC',
				ink: '#1F5F38',
				accent: '#B68B1F',
				hot: '#B5462C',
				dim: '#A6BE8C',
				fg: '#0E0D0B'
			}
		},
		peach: {
			neutral: {
				bg: '#FFE5CC',
				base: '#F4D5B8',
				ink: '#1F5F38',
				accent: '#B68B1F',
				hot: '#C04014',
				dim: '#D6B5A0',
				fg: '#3D2419'
			}
		}
	}
};
