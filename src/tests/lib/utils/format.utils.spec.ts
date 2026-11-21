import {
	formatProbability,
	formatToken,
	groupIntegerPart,
	probabilityToPercent
} from '#lib/utils/format.utils.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('format.utils', () => {
	describe('probabilityToPercent', () => {
		it('rounds a 0..1 probability to a whole percent', () => {
			assert.equal(probabilityToPercent(0), 0);
			assert.equal(probabilityToPercent(0.5), 50);
			assert.equal(probabilityToPercent(0.284), 28);
			assert.equal(probabilityToPercent(1), 100);
		});

		it('rounds a half percent up', () => {
			assert.equal(probabilityToPercent(0.005), 1);
			assert.equal(probabilityToPercent(0.125), 13);
		});
	});

	describe('formatProbability', () => {
		it('renders a whole percent with a percent sign', () => {
			assert.equal(formatProbability(0.5), '50%');
			assert.equal(formatProbability(0.995), '100%');
			assert.equal(formatProbability(0.001), '0%');
		});

		it('renders a non-finite input verbatim', () => {
			assert.equal(formatProbability(Number.NaN), 'NaN%');
		});
	});

	describe('groupIntegerPart', () => {
		// Stands in for a browser whose language is not English: the host default
		// locale is what `Intl.NumberFormat(undefined)` resolves to.
		const withHostLocale = ({ hostLocale, run }: { hostLocale: string; run: () => void }) => {
			const { NumberFormat } = Intl;
			Object.defineProperty(Intl, 'NumberFormat', {
				configurable: true,
				writable: true,
				value: class extends NumberFormat {
					constructor(locale?: string, options?: Intl.NumberFormatOptions) {
						super(locale ?? hostLocale, options);
					}
				}
			});

			try {
				run();
			} finally {
				Object.defineProperty(Intl, 'NumberFormat', {
					configurable: true,
					writable: true,
					value: NumberFormat
				});
			}
		};

		it('groups with commas around a dot decimal by default', () => {
			assert.equal(groupIntegerPart({ formatted: '1234567.50' }), '1,234,567.50');
			assert.equal(groupIntegerPart({ formatted: '-1234567' }), '-1,234,567');
			assert.equal(groupIntegerPart({ formatted: '999.1' }), '999.1');
		});

		for (const hostLocale of ['de-DE', 'it-IT', 'es-ES', 'pt-BR', 'fr-FR']) {
			it(`keeps the default separators coherent in a ${hostLocale} browser`, () => {
				withHostLocale({
					hostLocale,
					run: () => {
						assert.equal(groupIntegerPart({ formatted: '1234567.50' }), '1,234,567.50');
						assert.equal(
							formatToken({ value: 123456789n, unitName: 2, displayDecimals: 2 }),
							'1,234,567.89'
						);
					}
				});
			});
		}

		it('uses the decimal separator of an explicit locale', () => {
			assert.equal(groupIntegerPart({ formatted: '1234567.50', locale: 'de' }), '1.234.567,50');
			assert.equal(groupIntegerPart({ formatted: '-1234567.5', locale: 'it' }), '-1.234.567,5');
			assert.equal(groupIntegerPart({ formatted: '1234567', locale: 'it' }), '1.234.567');
		});
	});
});
