<!--
	The Menagerie glyph sprite: a single hidden <defs> block of 12 animal
	<symbol>s, consumed by <MenagerieBadge> via `<use href="#menagerie-{slug}">`.
	Mount once at the app shell so every badge on every surface can reference it.
	The animals are flat, two-tone marks coloured from the per-animal palette
	tokens declared on :root below.
-->
<svg class="menagerie-defs" aria-hidden="true" focusable="false" height="0" width="0">
	<defs>
		<symbol id="menagerie-hatchling" viewBox="0 0 100 100">
			<path
				d="M30 64 q-4 22 20 22 q24 0 20 -22 q-4 -10 -20 -10 q-16 0 -20 10Z"
				fill="var(--menagerie-hatchling-deep)"
			/>
			<path d="M31 62 l7 6 l6 -6 l6 6 l6 -6 l7 6 q-6 6 -19 6 q-13 0 -19 -6Z" fill="#F2ECDC" />
			<circle cx="50" cy="44" fill="var(--menagerie-hatchling)" r="22" />
			<circle cx="42" cy="42" fill="#0E0D0B" r="3.4" /><circle
				cx="58"
				cy="42"
				fill="#0E0D0B"
				r="3.4"
			/>
			<path d="M50 48 l8 4 l-8 4 l-8 -4 Z" fill="var(--menagerie-rooster-deep)" />
			<path d="M50 18 q3 -8 8 -7 q-2 5 -8 7Z" fill="var(--menagerie-hatchling-deep)" />
		</symbol>
		<symbol id="menagerie-beaver" viewBox="0 0 100 100">
			<path d="M64 70 q26 4 24 18 q-16 2 -26 -10Z" fill="var(--menagerie-beaver-deep)" />
			<path
				d="M66 72 q14 4 16 12 m-18 -8 q12 2 14 9"
				fill="none"
				opacity=".4"
				stroke="#0E0D0B"
				stroke-width="1.4"
			/>
			<ellipse cx="46" cy="56" fill="var(--menagerie-beaver)" rx="26" ry="22" />
			<path d="M26 30 l4 12 l8 -6Z" fill="var(--menagerie-beaver)" /><path
				d="M66 30 l-4 12 l-8 -6Z"
				fill="var(--menagerie-beaver)"
			/>
			<circle cx="38" cy="50" fill="#0E0D0B" r="3.4" /><circle
				cx="56"
				cy="50"
				fill="#0E0D0B"
				r="3.4"
			/>
			<ellipse cx="47" cy="60" fill="var(--menagerie-beaver-deep)" rx="6" ry="4.4" />
			<rect fill="#F2ECDC" height="8" rx="1.4" width="6" x="44" y="62" /><path
				d="M47 62 v8"
				stroke="var(--menagerie-beaver-deep)"
				stroke-width="1"
			/>
		</symbol>
		<symbol id="menagerie-rooster" viewBox="0 0 100 100">
			<path
				d="M36 80 q-18 -2 -16 -22 q2 -18 22 -22 q26 -5 30 14 q4 18 -10 30 q-12 10 -26 0Z"
				fill="var(--menagerie-rooster)"
			/>
			<path
				d="M30 36 q-2 -12 6 -14 q-1 7 2 8 q3 -10 10 -9 q-2 8 1 8 q4 -8 10 -5 q-3 7 0 9 q-12 6 -29 3Z"
				fill="#FF6B6B"
			/>
			<circle cx="40" cy="44" fill="#0E0D0B" r="3.4" />
			<path d="M28 50 l-12 -2 l11 -5Z" fill="var(--menagerie-bee)" />
			<path d="M34 58 q3 7 0 12 q-3 -2 -3 -7Z" fill="#FF6B6B" opacity=".85" />
			<path d="M62 56 q14 6 18 18 q-12 -2 -20 -10Z" fill="var(--menagerie-rooster-deep)" />
			<path
				d="M64 58 q10 5 13 14 m-16 -10 q8 4 11 11"
				fill="none"
				opacity=".35"
				stroke="#0E0D0B"
				stroke-width="1.3"
			/>
		</symbol>
		<symbol id="menagerie-snake" viewBox="0 0 100 100">
			<path
				d="M22 80 q-6 -12 10 -14 q20 -2 30 6 q8 6 -2 10 q-12 4 -22 -2"
				fill="none"
				stroke="var(--menagerie-snake)"
				stroke-linecap="round"
				stroke-width="11"
			/>
			<path
				d="M28 82 q-4 -9 8 -11 q16 -2 24 4"
				fill="none"
				opacity=".4"
				stroke="var(--menagerie-snake-deep)"
				stroke-linecap="round"
				stroke-width="11"
			/>
			<path
				d="M44 74 q14 -6 12 -24 q-1 -10 -4 -18"
				fill="none"
				stroke="var(--menagerie-snake)"
				stroke-linecap="round"
				stroke-width="11"
			/>
			<path
				d="M50 30 q-14 2 -12 -10 q2 -12 12 -12 q10 0 12 12 q2 12 -12 10Z"
				fill="var(--menagerie-snake)"
			/>
			<circle cx="45" cy="20" fill="#0E0D0B" r="2.6" /><circle
				cx="55"
				cy="20"
				fill="#0E0D0B"
				r="2.6"
			/>
			<path
				d="M50 30 l0 7 m0 0 l-3 4 m3 -4 l3 4"
				fill="none"
				stroke="#FF6B6B"
				stroke-linecap="round"
				stroke-width="1.6"
			/>
		</symbol>
		<symbol id="menagerie-owl" viewBox="0 0 100 100">
			<path
				d="M24 30 q6 -14 14 -4 m38 4 q-6 -14 -14 -4"
				fill="none"
				stroke="var(--menagerie-owl-deep)"
				stroke-linecap="round"
				stroke-width="3"
			/>
			<path
				d="M26 50 q0 -26 24 -26 q24 0 24 26 q0 28 -24 28 q-24 0 -24 -28Z"
				fill="var(--menagerie-owl)"
			/>
			<path
				d="M50 30 q-7 7 -7 17 q0 11 7 15 q7 -4 7 -15 q0 -10 -7 -17Z"
				fill="#F2ECDC"
				opacity=".24"
			/>
			<circle cx="40" cy="46" fill="#F2ECDC" r="9.5" /><circle
				cx="60"
				cy="46"
				fill="#F2ECDC"
				r="9.5"
			/>
			<circle cx="40" cy="46" fill="#0E0D0B" r="4.6" /><circle
				cx="60"
				cy="46"
				fill="#0E0D0B"
				r="4.6"
			/>
			<path d="M50 52 l5 5 l-5 4 l-5 -4Z" fill="var(--menagerie-bee)" />
			<path
				d="M34 70 l6 -7 m20 7 l-6 -7"
				stroke="var(--menagerie-owl-deep)"
				stroke-linecap="round"
				stroke-width="3"
			/>
		</symbol>
		<symbol id="menagerie-raven" viewBox="0 0 100 100">
			<path d="M14 72 l20 -7 l5 13Z" fill="var(--menagerie-raven-deep)" />
			<path
				d="M30 66 q-3 -22 20 -26 q18 -3 24 8 q4 8 -2 14 q9 2 11 13 q-22 8 -43 1 q-10 -3 -10 -13Z"
				fill="var(--menagerie-raven)"
			/>
			<circle cx="66" cy="40" fill="var(--menagerie-raven)" r="12" />
			<path d="M78 37 l17 -3 l-16 6Z" fill="var(--menagerie-bee)" />
			<path d="M79 43 l15 3 l-15 1Z" fill="var(--menagerie-bee-deep)" />
			<circle cx="68" cy="38" fill="#F2ECDC" r="2.7" /><circle
				cx="68"
				cy="38"
				fill="#0E0D0B"
				r="1.3"
			/>
		</symbol>
		<symbol id="menagerie-octopus" viewBox="0 0 100 100">
			<g fill="var(--menagerie-octopus)">
				<path d="M50 60 q-22 6 -26 26 q-1 8 5 8 q5 0 4 -7 q-1 -10 17 -19Z" />
				<path d="M50 62 q-12 8 -10 26 q0 7 6 6 q4 -1 2 -8 q-2 -10 5 -20Z" />
				<path d="M50 62 q0 14 2 24 q1 7 7 6 q4 -1 1 -8 q-4 -12 -3 -22Z" />
				<path d="M50 60 q22 6 26 26 q1 8 -5 8 q-5 0 -4 -7 q1 -10 -17 -19Z" />
			</g>
			<path
				d="M28 42 q0 -24 22 -24 q22 0 22 24 q0 20 -22 24 q-22 -4 -22 -24Z"
				fill="var(--menagerie-octopus)"
			/>
			<circle cx="41" cy="40" fill="#F2ECDC" r="6.6" /><circle
				cx="59"
				cy="40"
				fill="#F2ECDC"
				r="6.6"
			/>
			<circle cx="42" cy="41" fill="#0E0D0B" r="3.1" /><circle
				cx="60"
				cy="41"
				fill="#0E0D0B"
				r="3.1"
			/>
			<path
				d="M44 52 q6 4 12 0"
				fill="none"
				stroke="var(--menagerie-octopus-deep)"
				stroke-linecap="round"
				stroke-width="2"
			/>
			<circle cx="36" cy="74" fill="var(--menagerie-octopus-deep)" r="2" /><circle
				cx="50"
				cy="80"
				fill="var(--menagerie-octopus-deep)"
				r="2"
			/><circle cx="64" cy="74" fill="var(--menagerie-octopus-deep)" r="2" />
		</symbol>
		<symbol id="menagerie-magpie" viewBox="0 0 100 100">
			<path d="M14 88 q26 -10 42 -36 l8 9 q-17 27 -44 35Z" fill="var(--menagerie-magpie)" />
			<path
				d="M20 84 q23 -10 35 -31"
				fill="none"
				opacity=".5"
				stroke="var(--menagerie-magpie-deep)"
				stroke-width="2"
			/>
			<ellipse cx="58" cy="46" fill="var(--menagerie-magpie)" rx="18" ry="16" />
			<path d="M49 48 q9 7 19 2 q-2 12 -14 12 q-9 -6 -5 -14Z" fill="#F2ECDC" />
			<circle cx="68" cy="34" fill="var(--menagerie-magpie-deep)" r="10" />
			<path d="M76 32 l13 -2 l-12 5Z" fill="var(--menagerie-bee)" />
			<path d="M90 29 l4.5 4.5 l-4.5 4.5 l-4.5 -4.5Z" fill="#E2B842" />
			<path d="M90 29 l4.5 4.5 l-4.5 4.5Z" fill="#B68B1F" opacity=".6" />
			<circle cx="70" cy="32" fill="#F2ECDC" r="2.4" /><circle
				cx="70"
				cy="32"
				fill="#0E0D0B"
				r="1.1"
			/>
		</symbol>
		<symbol id="menagerie-badger" viewBox="0 0 100 100">
			<path
				d="M26 52 q0 -26 24 -26 q24 0 24 26 q0 28 -24 30 q-24 -2 -24 -30Z"
				fill="var(--menagerie-badger)"
			/>
			<path d="M30 30 q20 -8 40 0 q-2 14 -20 14 q-18 0 -20 -14Z" fill="#EDE6D4" />
			<circle cx="40" cy="40" fill="#0E0D0B" r="3.4" /><circle
				cx="60"
				cy="40"
				fill="#0E0D0B"
				r="3.4"
			/>
			<path d="M50 48 l5 5 l-5 4 l-5 -4Z" fill="#1A1813" />
			<path
				d="M44 60 q6 4 12 0"
				fill="none"
				stroke="#EDE6D4"
				stroke-linecap="round"
				stroke-width="2"
			/>
			<path
				d="M34 30 l-4 -8 m36 8 l4 -8"
				stroke="var(--menagerie-badger)"
				stroke-linecap="round"
				stroke-width="3"
			/>
		</symbol>
		<symbol id="menagerie-parrot" viewBox="0 0 100 100">
			<path d="M50 16 q-3 -9 4 -11 q1 5 4 6 q3 -7 10 -6 q-1 6 2 8Z" fill="#FF6B6B" opacity=".82" />
			<path
				d="M40 80 q-11 -6 -9 -28 q2 -23 25 -25 q17 -1 19 15 q2 12 -9 16 q7 18 -8 25 q-10 4 -18 -3Z"
				fill="var(--menagerie-parrot)"
			/>
			<path d="M34 56 q-11 6 -9 21 q11 -2 15 -13Z" fill="var(--menagerie-magpie)" opacity=".85" />
			<path d="M39 68 q-4 8 0 14 q6 -3 6 -11Z" fill="#4FD3A1" opacity=".5" />
			<circle cx="55" cy="34" fill="var(--menagerie-parrot)" r="15" />
			<path
				d="M41 33 q-15 -2 -17 7 q3 8 13 6 q-2 7 4 7 q9 -2 7 -13 q-1 -8 -7 -7Z"
				fill="var(--menagerie-bee)"
			/>
			<path d="M30 38 q-4 2 -2 6 q5 1 7 -3Z" fill="var(--menagerie-bee-deep)" />
			<circle cx="53" cy="32" fill="#F2ECDC" r="3" /><circle
				cx="53"
				cy="32"
				fill="#0E0D0B"
				r="1.4"
			/>
		</symbol>
		<symbol id="menagerie-bee" viewBox="0 0 100 100">
			<path d="M30 40 q-14 -10 -22 -4 q4 10 16 12Z" fill="#F2ECDC" opacity=".85" />
			<path d="M70 40 q14 -10 22 -4 q-4 10 -16 12Z" fill="#F2ECDC" opacity=".85" />
			<ellipse cx="50" cy="56" fill="var(--menagerie-bee)" rx="24" ry="26" />
			<path
				d="M28 48 q22 8 44 0 m-45 12 q23 9 46 0 m-43 13 q20 8 40 0"
				fill="none"
				stroke="var(--menagerie-badger)"
				stroke-width="5"
			/>
			<path
				d="M38 36 q-6 -12 0 -16 m24 16 q6 -12 0 -16"
				fill="none"
				stroke="var(--menagerie-badger)"
				stroke-linecap="round"
				stroke-width="2.4"
			/>
			<circle cx="42" cy="42" fill="#0E0D0B" r="3.2" /><circle
				cx="58"
				cy="42"
				fill="#0E0D0B"
				r="3.2"
			/>
		</symbol>
		<symbol id="menagerie-goat" viewBox="0 0 100 100">
			<path
				d="M45 32 Q40 18 34 8 Q31 3 28 7 Q29 18 38 30 Q41 33 46 35 Z"
				fill="var(--menagerie-goat-deep)"
			/>
			<path
				d="M55 32 Q60 18 66 8 Q69 3 72 7 Q71 18 62 30 Q59 33 54 35 Z"
				fill="var(--menagerie-goat-deep)"
			/>
			<path
				d="M31 9 Q33 16 38 24 M35 7 Q38 15 42 23"
				fill="none"
				opacity=".5"
				stroke="#0E0D0B"
				stroke-width="1"
			/>
			<path
				d="M69 9 Q67 16 62 24 M65 7 Q62 15 58 23"
				fill="none"
				opacity=".5"
				stroke="#0E0D0B"
				stroke-width="1"
			/>
			<path d="M36 46 Q24 48 18 58 Q24 60 32 55 Q37 51 38 47 Z" fill="#EDE6D4" />
			<path d="M64 46 Q76 48 82 58 Q76 60 68 55 Q63 51 62 47 Z" fill="#EDE6D4" />
			<path
				d="M37 42 Q37 33 50 33 Q63 33 63 42 Q63 61 59 71 Q55 81 50 81 Q45 81 41 71 Q37 61 37 42 Z"
				fill="var(--menagerie-goat)"
			/>
			<ellipse cx="44" cy="50" fill="#F2ECDC" rx="4" ry="3" /><ellipse
				cx="56"
				cy="50"
				fill="#F2ECDC"
				rx="4"
				ry="3"
			/>
			<rect fill="#0E0D0B" height="2.6" rx=".4" width="3" x="42.5" y="48.6" /><rect
				fill="#0E0D0B"
				height="2.6"
				rx=".4"
				width="3"
				x="54.5"
				y="48.6"
			/>
			<ellipse cx="50" cy="67" fill="#0E0D0B" rx="4.5" ry="3" />
			<path
				d="M50 70 v4 M46 74 Q50 77 54 74"
				fill="none"
				stroke="#0E0D0B"
				stroke-linecap="round"
				stroke-width="1.1"
			/>
			<path d="M44 81 Q43 91 50 93 Q57 91 56 81 Q53 83 50 83 Q47 83 44 81 Z" fill="#EDE6D4" />
		</symbol>
	</defs>
</svg>

<style lang="postcss">
	.menagerie-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	/*
		Per-animal palette tokens, declared once on :root so both this sprite's
		glyphs and the badge frames can reference `--menagerie-{slug}` /
		`--menagerie-{slug}-deep`. These are fixed brand colours (the JS mirror in
		`MENAGERIE_PALETTES` is used for the badge aura lookup); collision-safe
		against the YES/NO market palette. Keep the two in sync.
	*/
	:global(:root) {
		--menagerie-hatchling: #f2c14e;
		--menagerie-hatchling-deep: #c9912a;
		--menagerie-beaver: #bd8a52;
		--menagerie-beaver-deep: #8a6336;
		--menagerie-rooster: #f0883c;
		--menagerie-rooster-deep: #b85a1e;
		--menagerie-snake: #b89038;
		--menagerie-snake-deep: #846026;
		--menagerie-owl: #e2b842;
		--menagerie-owl-deep: #8c6e1a;
		--menagerie-raven: #5a6b92;
		--menagerie-raven-deep: #36405c;
		--menagerie-octopus: #b56c9b;
		--menagerie-octopus-deep: #854a73;
		--menagerie-magpie: #56a6b4;
		--menagerie-magpie-deep: #357c8b;
		--menagerie-badger: #45433d;
		--menagerie-badger-deep: #26251f;
		--menagerie-parrot: #7e89d6;
		--menagerie-parrot-deep: #4e5aa6;
		--menagerie-bee: #e0a52e;
		--menagerie-bee-deep: #9c6e14;
		--menagerie-goat: #7e5bc4;
		--menagerie-goat-deep: #543a8c;
	}
</style>
