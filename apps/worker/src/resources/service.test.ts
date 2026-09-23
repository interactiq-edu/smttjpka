import { describe, expect, it, vi } from 'vitest';
import { ResourceRepository } from './repository';
import { ResourceService } from './service';

const repository = () => ({
  updateContent: vi.fn().mockResolvedValue({ id: 'resource-1', title: 'Sample', content: { type: 'doc', content: [] } }),
}) as unknown as ResourceRepository;

describe('ResourceService rich text validation', () => {
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
