import { BaseNode, Node, Workflow, workflowManager, NodeDetector } from './workflow';
import { overlay } from './overlay';

// Node detector: determines which node we're at based on browser state
const imageWorkflowNodeDetector: NodeDetector = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  // Not on Flow at all
  if (!url.startsWith('https://labs.google')) {
    return 'browser';
  }

  // On Flow home page (no project open)
  if (url === 'https://labs.google/fx/tools/flow' ||
    url === 'https://labs.google/fx/tools/flow/') {
    return 'flowHomePage';
  }

  // On a project page
  if (url.includes('/fx/tools/flow/project/')) {
    return 'projectEditor';
  }

  // Default to browser
  return 'browser';
};

// Context for the image creation workflow
export interface ImageFlowContext {
  images: string[];
  style: string;
  productName: string;
  modelType: string;
  aspectRatio: string;
  imageCount: number;
  noTextOnImage: boolean;
  imageText: string;
  scene: string;
  tabId?: number;
  // State flags (set by check actions)
  isCreateImageModeSelected?: boolean;
  isSettingsConfigured?: boolean;
  isImagePickerOpen?: boolean;
  isCropDialogOpen?: boolean;
  isImageUploaded?: boolean;
  isPromptFilled?: boolean;
  isCreateClicked?: boolean;
  // Track current image upload index
  currentImageIndex?: number;
  // Auto save images after generation
  autoSaveImage?: boolean;
  // Track image count before generation (to know how many new images were created)
  imageCountBeforeGeneration?: number;
}

// Generate prompt based on style and context
function generatePrompt(ctx: ImageFlowContext): string {
  const productText = ctx.productName ? `This product is ${ctx.productName}.` : 'This product is as per the attached image.';
  const sceneText = ctx.scene ? ` Scene: ${ctx.scene}.` : '';

  // Text on image handling
  let textInstruction = '';
  if (ctx.noTextOnImage) {
    textInstruction = 'No text on the image.';
  } else if (ctx.imageText) {
    textInstruction = `Add this text in Thai on the image: "${ctx.imageText}"`;
  } else {
    textInstruction = 'Add advertising text in Thai on the image but no TikTok UI overlay.';
  }

  // Style-based prompt
  const stylePrompts: Record<string, string> = {
    'tiktok_real': `Create a professional product advertisement image. ${productText}
The first reference image is product.
TikTok style.
Ordinary person. Product review image in the style of an ordinary person. Don't hold a camera or taking a selfie.
Normal lighting, no lighting, no staging. Normal camera angle. Natural color tone, no photo editing.
Looks like a real ordinary person reviewing the product. Doesn't look like an advertisement. There is a product presenter from the attached image.${sceneText}
${textInstruction}`,

    'review': `Create a professional product review image. ${productText}
The first reference image is product.
Person holding the product for review. Natural pose, genuine expression.
Good lighting, clean background. Authentic review style.${sceneText}
${textInstruction}`,

    'hands_only': `Create a product image showing only hands. ${productText}
The first reference image is product.
Only hands visible, holding or presenting the product. Clean, professional look.
Focus on the product with elegant hand positioning.${sceneText}
${textInstruction}`,

    'professional': `Create a professional product advertisement. ${productText}
The first reference image is product.
High-end professional photography style. Perfect lighting, studio quality.
Model presenting product elegantly.${sceneText}
${textInstruction}`,

    'dramatic': `Create a dramatic product advertisement. ${productText}
The first reference image is product.
Bold, powerful imagery. Dramatic lighting and angles.
Impactful visual presentation.${sceneText}
${textInstruction}`,

    'minimalist': `Create a minimalist product image. ${productText}
The first reference image is product.
Clean, simple composition. Minimal elements, maximum impact.
White or neutral background, focus on product.${sceneText}
${textInstruction}`,

    'luxury': `Create a luxury product advertisement. ${productText}
The first reference image is product.
Premium, high-end aesthetic. Rich textures, elegant presentation.
Sophisticated and luxurious feel.${sceneText}
${textInstruction}`,
  };

  return stylePrompts[ctx.style] || stylePrompts['tiktok_real'];
}

// Base node with common actions
const baseNode = new BaseNode<ImageFlowContext>('base')
  .addAction('cancel', async () => {
    console.log('Workflow cancelled');
  }, null);

// Helper: wait for content script ready
async function waitForContentScript(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const checkReady = () => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (response?.ready) {
          resolve();
        } else {
          setTimeout(checkReady, 500);
        }
      });
    };
    checkReady();
  });
}

// Create image workflow factory
function createImageWorkflow(): Workflow<ImageFlowContext> {
  // Node: Browser (not on Flow yet)
  const browserNode = new Node<ImageFlowContext>('browser', baseNode)
    .addAction('openFlow', async (ctx) => {
      const tab = await chrome.tabs.create({
        url: 'https://labs.google/fx/tools/flow',
        active: true
      });
      ctx.tabId = tab.id;
      await waitForContentScript(ctx.tabId!);
    }, 'flowHomePage');

  // Node: Flow Home Page
  const flowHomePageNode = new Node<ImageFlowContext>('flowHomePage', baseNode)
    .addAction('ensureImageTabAndClickNewProject', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'flowHomePage', ctx);

        // Check if Image tab is active, if not click it
        const response = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CHECK_IMAGE_TAB_ACTIVE'
        });
        if (!response?.isActive) {
          await chrome.tabs.sendMessage(ctx.tabId, {
            type: 'CLICK_IMAGE_TAB'
          });
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Click New Project
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CLICK_ELEMENT',
          text: 'New project'
        });
        // Wait for navigation
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }, 'projectEditor');

  // Node: Project Editor (empty)
  const projectEditorNode = new Node<ImageFlowContext>('projectEditor', baseNode)
    // Check action: verify Create Image mode
    .addAction('checkCreateImageMode', async (ctx) => {
      if (ctx.tabId) {
        const response = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CHECK_CREATE_IMAGE_MODE'
        });
        ctx.isCreateImageModeSelected = response?.isCreateImage ?? false;
      }
    }, 'projectEditor') // Stay on same node

    // Act action: select Create Image mode
    .addAction('selectCreateImageMode', async (ctx) => {
      if (ctx.tabId) {
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'SELECT_CREATE_IMAGE_MODE'
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        ctx.isCreateImageModeSelected = true;
      }
    }, 'projectEditor') // Stay on same node

    // Check action: verify image picker state
    .addAction('checkImagePickerOpen', async (ctx) => {
      if (ctx.tabId) {
        console.log(`[checkImagePickerOpen] Checking if image picker is open...`);
        const response = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CHECK_IMAGE_PICKER_OPEN'
        });
        ctx.isImagePickerOpen = response?.isOpen ?? false;
        console.log(`[checkImagePickerOpen] isImagePickerOpen: ${ctx.isImagePickerOpen}`);
      }
    }, 'projectEditor')

    // Act action: open image picker
    .addAction('openImagePicker', async (ctx) => {
      if (ctx.tabId) {
        console.log(`[openImagePicker] Clicking "add" button to open image picker...`);
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'OPEN_IMAGE_PICKER'
        });
        await new Promise(resolve => setTimeout(resolve, 300));
        ctx.isImagePickerOpen = true;
        console.log(`[openImagePicker] Image picker opened`);
      }
    }, 'projectEditor')

    // Act action: upload image file
    .addAction('uploadImage', async (ctx) => {
      // Initialize index if not set
      if (ctx.currentImageIndex === undefined) {
        ctx.currentImageIndex = 0;
      }

      console.log(`[uploadImage] currentImageIndex: ${ctx.currentImageIndex}, total images: ${ctx.images.length}`);

      if (ctx.tabId && ctx.currentImageIndex < ctx.images.length) {
        console.log(`[uploadImage] Uploading image ${ctx.currentImageIndex + 1} of ${ctx.images.length}`);
        console.log(`[uploadImage] Image data length: ${ctx.images[ctx.currentImageIndex]?.length || 0} chars`);
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'UPLOAD_FILE',
          image: ctx.images[ctx.currentImageIndex]
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[uploadImage] Upload message sent, waiting for crop dialog...`);
      }
    }, 'projectEditor')

    // Check action: verify crop dialog state
    .addAction('checkCropDialogOpen', async (ctx) => {
      if (ctx.tabId) {
        console.log(`[checkCropDialogOpen] Checking if crop dialog is open...`);
        const response = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CHECK_CROP_DIALOG_OPEN'
        });
        ctx.isCropDialogOpen = response?.isOpen ?? false;
        console.log(`[checkCropDialogOpen] isCropDialogOpen: ${ctx.isCropDialogOpen}`);
      }
    }, 'projectEditor')

    // Check action: verify all images are uploaded to prompt box
    .addAction('checkAllImagesUploaded', async (ctx) => {
      if (ctx.tabId) {
        console.log(`[checkAllImagesUploaded] Checking if all images are uploaded...`);
        console.log(`[checkAllImagesUploaded] Expected count: ${ctx.images.length}`);
        const response = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CHECK_ALL_IMAGES_UPLOADED',
          expectedCount: ctx.images.length
        });

        if (response?.success) {
          ctx.isImageUploaded = response.isComplete;
          console.log(`[checkAllImagesUploaded] Result:`, {
            isComplete: response.isComplete,
            hasSpinnerInPromptBox: response.hasSpinnerInPromptBox,
            hasDisabledSlot: response.hasDisabledSlot,
            promptBoxImageCount: response.promptBoxImageCount,
            expectedCount: response.expectedCount,
            imagesRemaining: response.imagesRemaining
          });
        } else {
          console.log(`[checkAllImagesUploaded] Check failed:`, response?.error);
          ctx.isImageUploaded = false;
        }
      }
    }, 'projectEditor')

    // Act action: confirm crop dialog
    .addAction('confirmCrop', async (ctx) => {
      if (ctx.tabId) {
        console.log(`[confirmCrop] Confirming crop dialog with aspectRatio: ${ctx.aspectRatio}`);
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'HANDLE_CROP_DIALOG',
          aspectRatio: ctx.aspectRatio
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        ctx.isCropDialogOpen = false;

        // Increment image index after successful crop
        ctx.currentImageIndex = (ctx.currentImageIndex ?? 0) + 1;
        console.log(`[confirmCrop] Image cropped. New index: ${ctx.currentImageIndex}, total: ${ctx.images.length}`);

        // Check if all images are uploaded
        if (ctx.currentImageIndex >= ctx.images.length) {
          ctx.isImageUploaded = true;
          console.log(`[confirmCrop] All images uploaded!`);
        }
      }
    }, 'projectEditor') // Stay on projectEditor to continue uploading if more images

    // UI action: show overlay with node name and state
    .addAction('showNodeOverlay', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'projectEditor', ctx);
      }
    }, 'projectEditor') // Stay on same node

    // Act action: fill prompt with generated message
    .addAction('fillPrompt', async (ctx) => {
      if (ctx.tabId) {
        // Generate prompt based on style
        const prompt = generatePrompt(ctx);

        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'FILL_PROMPT',
          prompt
        });
        await new Promise(resolve => setTimeout(resolve, 300));

        ctx.isPromptFilled = true;
        console.log('[fillPrompt] Prompt filled');
      }
    }, 'projectEditor')

    // Act action: click Create button and wait for generation to complete
    .addAction('clickCreate', async (ctx) => {
      if (ctx.tabId) {
        // Save current image count before generation (for auto-download later)
        const countResponse = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'GET_IMAGE_COUNT'
        });
        ctx.imageCountBeforeGeneration = countResponse?.count || 0;
        console.log('[clickCreate] Image count before generation:', ctx.imageCountBeforeGeneration);

        // Click the Create button
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'CLICK_CREATE'
        });

        ctx.isCreateClicked = true;
        console.log('[clickCreate] Create button clicked, waiting for generation to start...');

        // Wait 3 seconds for generation to start (loading percentage to appear)
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Wait for generation to complete (poll every 10 seconds)
        const POLL_INTERVAL_MS = 10000; // 10 seconds
        const expectedNewImages = ctx.imageCount || 4;
        let pollCount = 0;

        await new Promise<void>((resolve) => {
          const checkComplete = () => {
            if (ctx.tabId) {
              pollCount++;
              console.log(`[clickCreate] Checking generation status (poll #${pollCount})...`);

              // Check both: no loading percentage AND new images created
              chrome.tabs.sendMessage(ctx.tabId, { type: 'CHECK_GENERATION_STATUS' }, (statusResponse) => {
                console.log(`[clickCreate] Status response:`, statusResponse);

                chrome.tabs.sendMessage(ctx.tabId!, { type: 'GET_IMAGE_COUNT' }, (countResp) => {
                  const currentCount = countResp?.count || 0;
                  const newImagesCreated = currentCount - (ctx.imageCountBeforeGeneration || 0);

                  console.log(`[clickCreate] Current image count: ${currentCount}, new images: ${newImagesCreated}/${expectedNewImages}`);

                  // Complete when: no loading percentage AND expected new images are created
                  const noLoadingIndicator = !statusResponse?.hasPercentage;
                  const hasNewImages = newImagesCreated >= expectedNewImages;

                  if (noLoadingIndicator && hasNewImages) {
                    console.log(`[clickCreate] Generation complete after ${pollCount} polls (${newImagesCreated} new images)`);
                    resolve();
                  } else {
                    console.log(`[clickCreate] Still loading (hasPercentage: ${statusResponse?.hasPercentage}, newImages: ${newImagesCreated}), next check in ${POLL_INTERVAL_MS / 1000}s...`);
                    setTimeout(checkComplete, POLL_INTERVAL_MS);
                  }
                });
              });
            }
          };
          checkComplete();
        });

        // Auto-download new images if enabled
        if (ctx.autoSaveImage) {
          console.log('[clickCreate] Auto-save enabled, downloading new images...');
          console.log('[clickCreate] Previous image count:', ctx.imageCountBeforeGeneration);
          console.log('[clickCreate] Expected new images:', ctx.imageCount);

          const downloadResponse = await chrome.tabs.sendMessage(ctx.tabId, {
            type: 'DOWNLOAD_NEW_IMAGES',
            previousCount: ctx.imageCountBeforeGeneration || 0,
            newImageCount: ctx.imageCount || 4
          });

          console.log('[clickCreate] Download response:', downloadResponse);
        }

        console.log('[clickCreate] Generation workflow complete!');
      }
    }, 'projectEditor')

    // Act action: configure settings (aspect ratio + output count)
    .addAction('configureSettings', async (ctx) => {
      if (ctx.tabId) {
        // Open settings dialog
        await chrome.tabs.sendMessage(ctx.tabId, { type: 'OPEN_SETTINGS' });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Set aspect ratio
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'SET_ASPECT_RATIO',
          ratio: ctx.aspectRatio
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Set output count
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'SET_OUTPUT_COUNT',
          count: ctx.imageCount
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Close settings dialog
        await chrome.tabs.sendMessage(ctx.tabId, { type: 'CLOSE_SETTINGS' });
        await new Promise(resolve => setTimeout(resolve, 300));

        ctx.isSettingsConfigured = true;
        console.log('[configureSettings] Settings configured');
      }
    }, 'projectEditor')

    // Action Resolver: decide which action to run
    .setActionResolver(async (ctx, node) => {
      if (!ctx.tabId) return null;

      console.log(`[ActionResolver] Starting decision...`);
      console.log(`[ActionResolver] Context state:`, {
        currentImageIndex: ctx.currentImageIndex,
        totalImages: ctx.images.length,
        isSettingsConfigured: ctx.isSettingsConfigured,
        isImageUploaded: ctx.isImageUploaded,
        isPromptFilled: ctx.isPromptFilled,
        isCreateClicked: ctx.isCreateClicked,
        isCreateImageModeSelected: ctx.isCreateImageModeSelected,
        isImagePickerOpen: ctx.isImagePickerOpen,
        isCropDialogOpen: ctx.isCropDialogOpen
      });

      // First, show the overlay
      await node.runAction('showNodeOverlay', ctx);

      // Step 1: Check if Create Image mode is selected
      await node.runAction('checkCreateImageMode', ctx);
      if (!ctx.isCreateImageModeSelected) {
        console.log(`[ActionResolver] Decision: selectCreateImageMode`);
        return 'selectCreateImageMode';
      }

      // Step 2: Configure settings before uploading images
      if (!ctx.isSettingsConfigured) {
        console.log(`[ActionResolver] Decision: configureSettings`);
        return 'configureSettings';
      }

      // Step 3: Check if all images are uploaded using the new check action
      // This checks: no spinner in prompt box AND image count matches expected
      await node.runAction('checkAllImagesUploaded', ctx);
      console.log(`[ActionResolver] After checkAllImagesUploaded: isImageUploaded = ${ctx.isImageUploaded}`);

      // Step 4: If all images are uploaded, fill prompt
      if (ctx.isImageUploaded && !ctx.isPromptFilled) {
        console.log(`[ActionResolver] Decision: fillPrompt`);
        return 'fillPrompt';
      }

      // Step 5: If prompt is filled, click Create button
      if (ctx.isImageUploaded && ctx.isPromptFilled && !ctx.isCreateClicked) {
        console.log(`[ActionResolver] Decision: clickCreate`);
        return 'clickCreate';
      }

      // Step 6: If Create is clicked, we're done
      if (ctx.isCreateClicked) {
        console.log(`[ActionResolver] Decision: null (workflow complete)`);
        return null; // Move to next node (handled by workflow)
      }

      // Step 7: Check if crop dialog is open (from previous upload)
      await node.runAction('checkCropDialogOpen', ctx);
      if (ctx.isCropDialogOpen) {
        console.log(`[ActionResolver] Decision: confirmCrop`);
        return 'confirmCrop';
      }

      // Step 8: Check if image picker is open
      await node.runAction('checkImagePickerOpen', ctx);
      if (ctx.isImagePickerOpen) {
        // Check if we still have images to upload
        const currentIndex = ctx.currentImageIndex ?? 0;
        console.log(`[ActionResolver] Image picker open. currentIndex: ${currentIndex}, total: ${ctx.images.length}`);
        if (currentIndex < ctx.images.length) {
          console.log(`[ActionResolver] Decision: uploadImage`);
          return 'uploadImage';
        }
      }

      // Step 9: Open image picker
      console.log(`[ActionResolver] Decision: openImagePicker`);
      return 'openImagePicker';
    });

  // Node: Project Editor (with images uploaded)
  const projectEditorWithImagesNode = new Node<ImageFlowContext>('projectEditorWithImages', baseNode)
    .addAction('configureSettings', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'projectEditorWithImages', ctx);

        // Open settings dialog
        await chrome.tabs.sendMessage(ctx.tabId, { type: 'OPEN_SETTINGS' });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Set aspect ratio
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'SET_ASPECT_RATIO',
          ratio: ctx.aspectRatio
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Set output count
        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'SET_OUTPUT_COUNT',
          count: ctx.imageCount
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // Close settings dialog
        await chrome.tabs.sendMessage(ctx.tabId, { type: 'CLOSE_SETTINGS' });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }, 'projectEditorConfigured');

  // Node: Project Editor (configured, ready to generate)
  const projectEditorConfiguredNode = new Node<ImageFlowContext>('projectEditorConfigured', baseNode)
    .addAction('generate', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'projectEditorConfigured', ctx);

        // Save current image count before generation (for auto-download later)
        const countResponse = await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'GET_IMAGE_COUNT'
        });
        ctx.imageCountBeforeGeneration = countResponse?.count || 0;
        console.log('[generate] Image count before generation:', ctx.imageCountBeforeGeneration);

        await chrome.tabs.sendMessage(ctx.tabId, {
          type: 'GENERATE_IMAGES'
        });
      }
    }, 'generating');

  // Node: Generating (waiting for result)
  // Polls every 10 seconds to check if generation is complete
  const generatingNode = new Node<ImageFlowContext>('generating', baseNode)
    .addAction('waitForResult', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'generating', ctx);
      }
      await new Promise<void>((resolve) => {
        const POLL_INTERVAL_MS = 10000; // 10 seconds
        let pollCount = 0;

        const checkComplete = () => {
          if (ctx.tabId) {
            pollCount++;
            console.log(`[waitForResult] Checking generation status (poll #${pollCount})...`);

            chrome.tabs.sendMessage(ctx.tabId, { type: 'CHECK_GENERATION_STATUS' }, (response) => {
              console.log(`[waitForResult] Response:`, response);

              if (response?.complete) {
                console.log(`[waitForResult] Generation complete after ${pollCount} polls`);
                resolve();
              } else {
                console.log(`[waitForResult] Still loading, next check in ${POLL_INTERVAL_MS / 1000}s...`);
                setTimeout(checkComplete, POLL_INTERVAL_MS);
              }
            });
          }
        };
        checkComplete();
      });
    }, 'completed');

  // Node: Completed
  const completedNode = new Node<ImageFlowContext>('completed', baseNode)
    .addAction('finish', async (ctx) => {
      if (ctx.tabId) {
        await overlay.showNodeName(ctx.tabId, 'completed', ctx);

        // Auto-download new images if enabled
        if (ctx.autoSaveImage) {
          console.log('[finish] Auto-save enabled, downloading new images...');
          console.log('[finish] Previous image count:', ctx.imageCountBeforeGeneration);
          console.log('[finish] Expected new images:', ctx.imageCount);

          const downloadResponse = await chrome.tabs.sendMessage(ctx.tabId, {
            type: 'DOWNLOAD_NEW_IMAGES',
            previousCount: ctx.imageCountBeforeGeneration || 0,
            newImageCount: ctx.imageCount || 4
          });

          console.log('[finish] Download response:', downloadResponse);
        }

        await overlay.hide(ctx.tabId);
      }
    }, null);

  return new Workflow<ImageFlowContext>()
    .setNodeDetector(imageWorkflowNodeDetector)
    .addNode(browserNode)
    .addNode(flowHomePageNode)
    .addNode(projectEditorNode)
    .addNode(projectEditorWithImagesNode)
    .addNode(projectEditorConfiguredNode)
    .addNode(generatingNode)
    .addNode(completedNode);
}

// Register the workflow
workflowManager.register('image', createImageWorkflow);
