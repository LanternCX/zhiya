import React from 'react';
import {Composition} from 'remotion';
import {TeacherSample} from './TeacherSample';
import {FullFilm} from './full/FullFilm';
import {JourneyFilm} from './real/JourneyFilm';
import {RhythmReview,rhythmReviewFrames} from './real/RhythmReview';
import {SourceReplay} from './real/SourceReplay';
import {CompactFilm,compactFrames} from './real/CompactFilm';
import {StudentFilm,studentFrames} from './student/StudentFilm';

export const Root: React.FC = () => (
  <>
    <Composition id="StudentFilm" component={StudentFilm} durationInFrames={studentFrames} fps={30} width={1920} height={1080}/>
    <Composition id="SourceReplayReview" component={SourceReplay} defaultProps={{shot:'generate'}} durationInFrames={900} fps={30} width={1920} height={1080}/>
    <Composition id="TeacherRhythmReview" component={RhythmReview} durationInFrames={rhythmReviewFrames} fps={30} width={1920} height={1080} />
    <Composition id="TeacherSample" component={TeacherSample} durationInFrames={1350} fps={30} width={1920} height={1080} />
    <Composition id="TeacherFilm" component={CompactFilm} durationInFrames={compactFrames} fps={30} width={1920} height={1080} />
    <Composition id="ArchivedRecordedFilm" component={JourneyFilm} durationInFrames={18000} fps={30} width={1920} height={1080} />
    <Composition id="ArchivedConcept" component={FullFilm} durationInFrames={18000} fps={30} width={1920} height={1080} />
  </>
);
