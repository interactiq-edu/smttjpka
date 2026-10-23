import { describe, expect, it, vi } from 'vitest';
import { QUIZ_THEME_IDS } from '@interactiq/contracts';
import { ResourceRepository } from './repository';
import { ResourceService } from './service';

const repository = () => ({
  updateContent: vi.fn().mockResolvedValue({ id: 'resource-1', title: 'Sample', content: { type: 'doc', content: [] } }),
}) as unknown as ResourceRepository;

describe('ResourceService rich text validation', () => {
  it('saves only valid local library display badges', async () => {
    const updateDisplayBadge = vi.fn().mockResolvedValue({ id: 'resource-1', displayBadgeId: 30 });
    const service = new ResourceService({ updateDisplayBadge } as unknown as ResourceRepository);
    await expect(service.updateDisplayBadge('tenant-a', 'resource-1', { badgeId: 30 })).resolves.toMatchObject({ displayBadgeId: 30 });
    expect(updateDisplayBadge).toHaveBeenCalledWith('tenant-a', 'resource-1', 30);
    await expect(service.updateDisplayBadge('tenant-a', 'resource-1', { badgeId: 31 })).rejects.toThrow('30 display badges');
    await expect(service.updateDisplayBadge('tenant-a', 'resource-1', { badgeId: '1' })).rejects.toThrow('30 display badges');
  });

  it('keeps visual badge metadata on a resource duplicate without changing quiz behavior', async () => {
    const updateDisplayBadge = vi.fn().mockResolvedValue({ id: 'copy-1', displayBadgeId: 7 });
    const fake = {
      findDetailById: vi.fn().mockResolvedValue({ id: 'resource-1', title: 'Original', description: '', type: 'QUIZ', attemptPolicy: 'SINGLE', assignedClassName: null, assignedClassNames: [], content: { type: 'doc', content: [] }, themeOverrideId: null, displayBadgeId: 7, assetUrl: null, externalUrl: null }),
      create: vi.fn().mockResolvedValue({ id: 'copy-1' }),
      updateAssignedClass: vi.fn(), updateContent: vi.fn(), updateTheme: vi.fn(), updateDisplayBadge, updateDelivery: vi.fn(),
      listFlashcards: vi.fn().mockResolvedValue([]), findById: vi.fn().mockResolvedValue({ id: 'copy-1', displayBadgeId: 7 }),
    } as unknown as ResourceRepository;
    await expect(new ResourceService(fake).duplicate('tenant-a', 'admin-a', 'resource-1')).resolves.toMatchObject({ displayBadgeId: 7 });
    expect(updateDisplayBadge).toHaveBeenCalledWith('tenant-a', 'copy-1', 7);
  });

  it.each(QUIZ_THEME_IDS)('accepts the %s theme for a resource override', async (themeId) => {
    const updateTheme = vi.fn().mockResolvedValue({ id: 'resource-1', themeId, themeOverrideId: themeId });
    const service = new ResourceService({ updateTheme } as unknown as ResourceRepository);
    await expect(service.updateTheme('tenant-a', 'resource-1', { themeId })).resolves.toMatchObject({ themeId });
    expect(updateTheme).toHaveBeenCalledWith('tenant-a', 'resource-1', themeId);
  });

  it('allows a quiz to return to the global theme and rejects unknown themes', async () => {
    const updateTheme = vi.fn().mockResolvedValue({ id: 'resource-1', themeId: 'GLASSWAVE_LEARN', themeOverrideId: null });
    const service = new ResourceService({ updateTheme } as unknown as ResourceRepository);
    await expect(service.updateTheme('tenant-a', 'resource-1', { themeId: null })).resolves.toMatchObject({ themeOverrideId: null });
    expect(updateTheme).toHaveBeenCalledWith('tenant-a', 'resource-1', null);
    await expect(service.updateTheme('tenant-a', 'resource-1', { themeId: 'UNKNOWN' })).rejects.toThrow('Select a valid quiz theme');
  });

  it('validates the tenant-wide GlassWave choice without changing a resource override', async () => {
    const updateThemeSettings = vi.fn().mockResolvedValue({ defaultTheme: 'GLASSWAVE_LEARN' });
    const service = new ResourceService({ updateThemeSettings } as unknown as ResourceRepository);
    await expect(service.updateThemeSettings('tenant-a', { defaultTheme: 'GLASSWAVE_LEARN' })).resolves.toMatchObject({ defaultTheme: 'GLASSWAVE_LEARN' });
    expect(updateThemeSettings).toHaveBeenCalledWith('tenant-a', 'GLASSWAVE_LEARN');
    await expect(service.updateThemeSettings('tenant-a', { defaultTheme: 'UNKNOWN' })).rejects.toThrow('Select a valid default theme');
  });

  it('publishes a Quiz with its selected music and latest-result replacement policy', async () => {
    const publish = vi.fn().mockResolvedValue({ id:'resource-1', type:'QUIZ', shareCode:'QUIZ1234' });
    const fake = {
      findById: vi.fn().mockResolvedValue({ id:'resource-1', type:'QUIZ' }),
      findMusicTrack: vi.fn().mockResolvedValue({ id:'track-1' }),
      publish,
    } as unknown as ResourceRepository;
    const service = new ResourceService(fake);

    await service.publish('tenant-a','resource-1',{ attemptPolicy:'MULTIPLE', resultReleasePolicy:'IMMEDIATE_PER_QUESTION', replacePreviousAttempts:true, musicTrackId:'11111111-1111-4111-8111-111111111111', accessStartsAt:null });

    expect(publish).toHaveBeenCalledWith('tenant-a','resource-1',expect.any(String),'MULTIPLE','IMMEDIATE_PER_QUESTION',null,true,'11111111-1111-4111-8111-111111111111');
  });

  it('accepts a structured document using an https link', async () => {
    const service = new ResourceService(repository());
    await expect(service.updateContent('tenant-a', 'resource-1', {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read this', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] },
    })).resolves.toMatchObject({ id: 'resource-1' });
  });

  it('rejects unsafe link protocols before they reach D1', async () => {
    const service = new ResourceService(repository());
    await expect(service.updateContent('tenant-a', 'resource-1', {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    })).rejects.toThrow('unsupported content');
  });

  it('rejects an oversized live whiteboard before it reaches D1', async () => {
    const fake = {
      findById: vi.fn().mockResolvedValue({ id: 'resource-1', type: 'PRESENTATION' }),
      updateLiveState: vi.fn(),
    } as unknown as ResourceRepository;
    const service = new ResourceService(fake);
    const points = Array.from({ length: 20_001 }, (_, index) => ({ x: index % 2, y: index % 2 }));
    await expect(service.updateLiveState('tenant-a', 'resource-1', {
      currentSlide: 1,
      activeQuestionId: null,
      whiteboard: [{ color: '#6d5dfc', size: 5, points }],
    })).rejects.toThrow('Invalid live classroom state');
  });

  it('stores presentation download permission only when the admin enables it', async () => {
    const updateLiveState = vi.fn().mockImplementation((_tenantId, resourceId, state) => ({
      resourceId,
      ...state,
      updatedAt: '2026-09-21T00:00:00.000Z',
    }));
    const fake = {
      findById: vi.fn().mockResolvedValue({ id: 'resource-1', type: 'PRESENTATION' }),
      updateLiveState,
    } as unknown as ResourceRepository;
    const service = new ResourceService(fake);

    await service.updateLiveState('tenant-a', 'resource-1', {
      currentSlide: 1,
      activeQuestionId: null,
      whiteboard: [],
      presentationMode: 'SLIDE',
      allowDownload: true,
      showCurrentSlide: true,
      showQuiz: false,
    });
    await service.updateLiveState('tenant-a', 'resource-1', {
      currentSlide: 1,
      activeQuestionId: null,
      whiteboard: [],
      presentationMode: 'SLIDE',
    });

    expect(updateLiveState).toHaveBeenNthCalledWith(1, 'tenant-a', 'resource-1', expect.objectContaining({ allowDownload: true }));
    expect(updateLiveState).toHaveBeenNthCalledWith(2, 'tenant-a', 'resource-1', expect.objectContaining({ allowDownload: false }));
  });

  it('stores a bounded presentation zoom for live participants', async () => {
    const updateLiveState = vi.fn().mockImplementation((_tenantId, resourceId, state) => ({ resourceId, ...state, updatedAt: '2026-09-21T00:00:00.000Z' }));
    const fake = {
      findById: vi.fn().mockResolvedValue({ id: 'resource-1', type: 'PRESENTATION' }),
      updateLiveState,
    } as unknown as ResourceRepository;
    const service = new ResourceService(fake);

    await service.updateLiveState('tenant-a', 'resource-1', { currentSlide: 2, currentZoom: 130, whiteboard: [] });
    expect(updateLiveState).toHaveBeenCalledWith('tenant-a', 'resource-1', expect.objectContaining({ currentZoom: 130 }));
    await expect(service.updateLiveState('tenant-a', 'resource-1', { currentSlide: 2, currentZoom: 210, whiteboard: [] })).rejects.toThrow('Invalid live classroom state');
  });

  it('accepts a flashcard with structured front and back content', async () => {
    const card = { id: 'card-1', resourceId: 'resource-1', front: { type: 'doc', content: [] }, back: { type: 'doc', content: [] }, position: 0 };
    const fake = {
      findById: vi.fn().mockResolvedValue({ id: 'resource-1', type: 'FLASHCARD_SET' }),
      createFlashcard: vi.fn().mockResolvedValue(card),
    } as unknown as ResourceRepository;
    await expect(new ResourceService(fake).saveFlashcard('tenant-a', 'resource-1', null, { front: card.front, back: card.back })).resolves.toMatchObject({ id: 'card-1' });
  });
});
