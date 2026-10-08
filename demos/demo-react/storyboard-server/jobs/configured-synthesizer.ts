import type { SynthesizedShotAudio } from '../render/video-renderer';
import { getTtsProviderConfig } from '../tts/provider-config';
import { AliyunStoryboardSynthesizer } from './aliyun-synthesizer';
import { FakeStoryboardSynthesizer } from './fake-synthesizer';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';
import { LocalEspeakStoryboardSynthesizer } from './local-espeak-synthesizer';
import { EdgeTtsStoryboardSynthesizer } from './neural-tts';
import { TencentStoryboardSynthesizer } from './tencent-synthesizer';

function configuredProvider(): StoryboardSynthesizer {
	switch (getTtsProviderConfig().provider) {
		case 'aliyun':
			return new AliyunStoryboardSynthesizer();
		case 'tencent':
			return new TencentStoryboardSynthesizer();
		case 'local':
			return new LocalEspeakStoryboardSynthesizer();
		case 'fake':
			return new FakeStoryboardSynthesizer();
		default:
			return new EdgeTtsStoryboardSynthesizer();
	}
}

export class ConfiguredStoryboardSynthesizer implements StoryboardSynthesizer {
	get providerName(): string {
		return configuredProvider().providerName ?? 'unknown';
	}

	synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		return configuredProvider().synthesize(input);
	}
}
