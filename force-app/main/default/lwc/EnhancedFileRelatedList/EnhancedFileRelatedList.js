import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from "@salesforce/apex";
import getAttachments from '@salesforce/apex/AttachmentController.getAttachments';
import deleteContentVersions from '@salesforce/apex/AttachmentController.deleteContentVersions';
import uploadFile from '@salesforce/apex/AttachmentController.uploadFile';
/**
 *  1. upload file s direttamente dal pulsante
 *  2. icone file se non c'è la tumbnail
 *  3. trackare la delete standard e refreshare la lista di file
 */

export default class MassDownloadAttachments extends NavigationMixin(LightningElement) {
    @api recordId;
    @track attachments = [];
    @track selectedFileIds = new Set();
    @track isLoading = false;
    @track isVisible = true;
    @track allSelected = false;

    isModalOpen = false //modale
    mutationObserver;
    fileCount = 0;
    downloadPrefixURL = '/sfc/servlet.shepherd/version/download/';
    wiredAttachmentsResult;

    get title() {
        return `Files (${this.fileCount})`;
    }
    get viewAllUrl() {
        return `/lightning/r/Rapportino__c/${this.recordId}/related/AttachedContentDocuments/view?ws=%2Flightning%2Fr%2FRapportino__c%2F${this.recordId}%2Fview`;
    }
    get showViewAll() {
        return this.fileCount > 0;
    }
    get isNoSelection() {
        return this.selectedFileIds.size === 0;
    }
    get isAttachmentsEmpty() {
        return this.attachments.length === 0;
    }
    get selectAllLabel() {
        return this.allSelected ? 'Deselect All' : 'Select All';
    }

    handleUploadClick() {
        this.isVisible = false;
        this.isModalOpen = true;
    }

    closeModal() {
        this.isModalOpen = false;
    }
    
    handleUploadFinished2(event) {
        const uploadedFiles = event.detail.files;
        console.log('Files caricati:', JSON.stringify(uploadedFiles));
        this.isLoading = true;
        let attempts = 0;
        const maxAttempts = 5;
        const intervalId = setInterval(() => {
            this.refreshAttachments();
            if (++attempts >= maxAttempts) {
                clearInterval(intervalId);
                this.isLoading = false;
            }
        }, 1000);
        this.dispatchEvent(
            new CustomEvent('filesupload', {
                detail: { files: uploadedFiles }
            })
        );
        
        this.closeModal();
    }

    // handleFilesChange(event) {
    //     const files = event.target.files;
    //     if (files.length === 0) return;
        
    //     this.isLoading = true;
    //     let uploadedCount = 0;
    //     let errorCount = 0;
        
    //     Array.from(files).forEach(file => {
    //         const reader = new FileReader();
    //         reader.onload = () => {
    //             const fileContents = reader.result.split(',')[1];
                
    //             uploadFile({
    //                 recordId: this.recordId,
    //                 fileName: file.name,
    //                 base64Data: encodeURIComponent(fileContents),
    //                 contentType: file.type
    //             })
    //             .then(() => {
    //                 uploadedCount++;
    //                 if (uploadedCount + errorCount === files.length) {
    //                     this.uploadComplete(uploadedCount, errorCount);
    //                 }
    //             })
    //             .catch(error => {
    //                 errorCount++;
    //                 console.error('Errore caricamento file:', error);
    //                 if (uploadedCount + errorCount === files.length) {
    //                     this.uploadComplete(uploadedCount, errorCount);
    //                 }
    //             });
    //         };
    //         reader.readAsDataURL(file);
    //     });
    // }
    
    // uploadComplete(successCount, errorCount) {
    //     // if (successCount > 0) {
    //     //     this.showToast('Successo', `${successCount} file caricati con successo`, 'success');
    //     // }
        
    //     // if (errorCount > 0) {
    //     //     this.showToast('Attenzione', `${errorCount} file non sono stati caricati correttamente`, 'warning');
    //     // }
    //     this.refreshAttachments();
    //     const fileInput = this.template.querySelector('input[type="file"]');
    //     fileInput.value = '';
    // }

    connectedCallback() {
        this.setupMutationObserver(); //refresh file su delete standard
    }
    
    disconnectedCallback() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
    }
    
    setupMutationObserver() {
        this.mutationObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1) { 
                            if (node.classList && (
                                node.classList.contains('slds-notify') || 
                                node.classList.contains('forceModalActionContainer') ||
                                node.textContent.includes('elimin') ||
                                node.textContent.includes('delet')
                            )) {
                                setTimeout(() => this.refreshAttachments(), 1000);
                                break;
                            }
                        }
                    }
                }
            }
        });
        this.mutationObserver.observe(document.body, { 
            childList: true, 
            subtree: true 
        });
    }

    @wire(getAttachments, { recordId: '$recordId' })
    wiredAttachments(result) {
        this.wiredAttachmentsResult = result;
        const { data, error } = result;
        if (data) {
            this.attachments = data.map(file => {
                const ext = file.FileExtension?.toLowerCase();
                const unsupportedThumbs = ['zip','csv','json', 'xml'];
                return {
                    ...file,
                    CreatedDate: new Date(file.CreatedDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }),
                    Size: Math.round(file.ContentSize / 1024),
                    fileUrl: `/sfc/servlet.shepherd/document/view/${file.Id}`,
                    thumbnailUrl: !unsupportedThumbs.includes(ext) ? `/sfc/servlet.shepherd/version/renditionDownload?rendition=thumb120by90&versionId=${file.LatestPublishedVersionId}&operationContext=CHATTER&contentId=${file.Id}&page=0`: '',
                    iconName: ext ? `doctype:${ext}` : 'standard:file'
                };
                
            });
            
            this.fileCount = this.attachments.length;
            this.isVisible = this.fileCount === 0;
        } else if (error) {
            console.error('Errore nel recupero dei file', error);
        }
        this.isLoading = false;
    }

    handleCheckboxChange(event) {
        const fileId = event.target.dataset.id;
        event.target.checked ? this.selectedFileIds.add(fileId) : this.selectedFileIds.delete(fileId);
        this.allSelected = this.selectedFileIds.size === this.attachments.length;
        this.selectedFileIds = new Set(this.selectedFileIds);
    }


    toggleSelectAll() {
        this.allSelected = !this.allSelected;
        this.selectedFileIds = new Set();
        this.template.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.checked = this.allSelected;
            if (this.allSelected) this.selectedFileIds.add(cb.dataset.id);
        });
    }

    // Seleziona/Deseleziona tutti
    handleSelectAll(event) {
        if (event.target.checked) {
            this.attachments.forEach(file => this.selectedFileIds.add(file.LatestPublishedVersionId));
        } else {
            this.selectedFileIds.clear();
        }
        this.selectedFileIds = new Set(this.selectedFileIds); // reattività
        this.template.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = event.target.checked);
    }

    handleUploadFinished() {
        this.isLoading = true;
        let attempts = 0;
        const maxAttempts = 5;
        const intervalId = setInterval(() => {
            this.refreshAttachments();
            if (++attempts >= maxAttempts) {
                clearInterval(intervalId);
                this.isLoading = false;
            }
        }, 1000);
    }

    refreshAttachments() {
        refreshApex(this.wiredAttachmentsResult).finally(() => this.isLoading = false);
    }

    

    handleDownloadSelected() {
        if (this.selectedFileIds.size === 0) return;
        const filesToDownload = Array.from(this.selectedFileIds).join('/');
        window.open(`${window.location.origin}${this.downloadPrefixURL}${filesToDownload}`, '_blank');
    }

    handlePreview(event) {
        this[NavigationMixin.Navigate]({
            type: 'standard__namedPage',
            attributes: { pageName: 'filePreview' },
            state: { selectedRecordId: event.currentTarget.dataset.id }
        });
    }

    navigateToViewAll() {
        this[NavigationMixin.Navigate]({
            type: 'standard__webPage',
            attributes: { url: this.viewAllUrl }
        });
    }

    async handleDeleteSelected() {
        if (this.selectedFileIds.size === 0) return;
        this.isLoading = true;

        try {
            await deleteContentVersions({ contentVersionIds: Array.from(this.selectedFileIds) });
            this.showToast('Successo', 'File eliminati con successo.', 'success');
        } catch (error) {
            console.error('Errore durante l\'eliminazione:', JSON.stringify(error));
            this.showToast('Errore', 'Si è verificato un errore durante l\'eliminazione dei file.', 'error');
        } finally {
            this.selectedFileIds.clear();
            this.allSelected = false;
            // await this.refreshAttachments();
            this.isVisible = this.attachments.length === 0;
            this.selectedFileIds = new Set();
            this.isLoading = false;
        }
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
