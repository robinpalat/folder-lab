import { FocusContext } from './FocusContext';
import {
    FocusWidget,
    FocusWidgetFactory,
    WidgetCallbacks
} from './FocusWidget';
import { i18n } from '../i18n/I18nService';
import {
  getWidgetDefinitionLabel,
  getWidgetDefinitionEmptyState,
  getWidgetDefinitionPlaceholder
} from './widgets/definitionTexts';

import { WidgetDefinition } from './WidgetDefinition';
import { WidgetController } from './controllers/WidgetController';

import { FocusListItem } from './FocusListItem';
import { WidgetControls } from './widgets/tools/WidgetControls';

import {
    WidgetControlsHandle,
    WidgetControlsRenderer
} from './widgets/tools/WidgetControlsRenderer';
import {
    FolderLabDragDrop,
    createExpandableText
} from './FocusWidgetsUtils';

import { App, Notice } from 'obsidian';
type WidgetRecord = Record<string, any>;


export class DeclarativeWidget
    implements FocusWidget {

    readonly id: string;


    get label(): string {
        return (
            this.instanceName ??
            getWidgetDefinitionLabel(this.definition)
        );
    }

    get icon(): string {
        return this.definition.identity.icon ?? 'square';
    }

    private container:
        HTMLElement | null = null;

    private context:
        FocusContext | null = null;

    private position:
        'top' | 'bottom' = 'top';

    private callbacks:
        WidgetCallbacks = {};

    private listElement:
        HTMLElement | null = null;

    private emptyElement:
        HTMLElement | null = null;

    private dropCleanup:
        (() => void) | null = null;
    private changeCleanup:
        (() => void) | null = null;

    private controlsHandle:
        WidgetControlsHandle | null = null;

    private items:
        Record<string, any>[] = [];

    constructor(
        private readonly definition: WidgetDefinition,
        private readonly controller: WidgetController,
        private readonly app: App,
        private instanceId?: string
    ) {
        this.id = definition.id;

        this.changeCleanup =
            this.controller.onChange(() => {
                void this.reload();
            });
    }

    private instanceName: string | null = null;

    // ============================================================
    // PUBLIC API
    // ============================================================



    setInstanceIdentity(
        instanceId: string,
        name: string
    ): void {
        this.instanceId = instanceId;
        this.instanceName = name;
    }

    setPosition(
        position: 'top' | 'bottom'
    ): void {

        this.position =
            position;
    }


    setCallbacks(
        callbacks: WidgetCallbacks
    ): void {

        this.callbacks =
            callbacks;
    }


    render(
        container: HTMLElement,
        context: FocusContext
    ): void {

        this.container =
            container;

        this.context =
            context;

        container.empty();

        container.addClass(
            `fl-widget-${this.id}`
        );

        if (!context.activeFile) {

            this.renderEmpty(
                i18n.t('widgets.declarative.empty.noteRequired', { label: this.label })
            );

            return;
        }

        if (this.position === 'top') {
            this.renderControls();
            this.renderContent();
        } else {
            this.renderContent();
            this.renderControls();
        }

        void this.reload();
    }


    update(
        context: FocusContext
    ): void {

        this.context =
            context;

        if (!this.container) {
            return;
        }

        this.render(
            this.container,
            context
        );
    }


    destroy(): void {

        this.dropCleanup?.();
        this.dropCleanup = null;

        this.changeCleanup?.();
        this.changeCleanup = null;

        if (this.container) {
            this.container.empty();
        }

        this.container = null;
        this.context = null;
        this.listElement = null;
        this.emptyElement = null;
    }


    // ============================================================
    // STORAGE ID
    // ============================================================

    private getInstanceId(): string {
        return this.instanceId ?? this.id;
    }


    private getStorageKey(): string {

        return this.id;
    }


    // ============================================================
    // CONTROLES
    // ============================================================

    private renderControls(): void {

        if (!this.container) {
            return;
        }

        const controls =
            this.definition.controls;

        if (!controls?.length) {
            return;
        }

        const config =
            new WidgetControls();

        config.setWidget({
            id: this.id,
            label: this.label,
            icon: this.icon,
            color: this.definition.identity.color,
            options: [],
        });

        for (const control of controls) {

            if (
                control.type === 'status' &&
                control.id
            ) {

                const stats =
                    this.getMetrics();

                const value =
                    stats[control.metric ?? 'total']
                    ?? 0;

                config.status({
                    id: control.id,
                    label: `${value}`,
                    state: 'default'
                });

                continue;
            }

            if (
                control.type === 'icon-action' &&
                control.id
            ) {

                config.iconAction({
                    id: control.id,
                    icon: control.icon ?? 'circle',
                    tooltip:
                        control.label ??
                        control.id
                });
            }
        }

        this.controlsHandle =
            WidgetControlsRenderer.render(
                this.container,
                config.getConfig(),
                {
                    onWidgetSelect: () => {
                        this.callbacks.onWidgetSelect?.();
                    },

                    onSourceSelect: () => { },

                    onControlSelect: () => { },

                    onAction: (controlId: string) => {
                        void this.executeControl(
                            controlId
                        );
                    }
                }
            );

    }


    private async executeControl(
        controlId: string
    ): Promise<void> {

        if (!this.context?.activeFile) {
            return;
        }

        const action =
            this.definition.controls
                ?.find(
                    control =>
                        control.id === controlId
                );

        if (!action) {
            return;
        }

        if (action.id === 'clear') {

            await this.controller.storage.clear(
                this.getStorageKey(),
                this.context.activeFile.path,
                this.getInstanceId()
            );

            await this.reload();

            new Notice(
                i18n.t('widgets.declarative.notice.cleared', { label: this.label })
            );
        }


        if (
            action.id === 'clear-completed'
        ) {

            const field =
                this.definition.state?.field;

            if (!field) {
                return;
            }

            await this.controller.clearByState(
                this.getStorageKey(),
                this.context.activeFile.path,
                this.getInstanceId(),
                field,
                true
            );

            await this.reload();

            new Notice(
                i18n.t('widgets.declarative.notice.completedCleared')
            );

            return;
        }

    }


    // ============================================================
    // CONTENT
    // ============================================================

    private renderContent(): void {

        if (!this.container) {
            return;
        }

        this.dropCleanup?.();
        this.dropCleanup = null;

        const wrapper =
            this.container.createEl('div', {
                cls: 'fl-widget-content-expanded'
            });

        if (this.definition.input?.text?.enabled) {
            this.renderTextInput(wrapper);
        }

        const listWrapper =
            wrapper.createEl('div', {
                cls: 'fl-focus-list-wrapper'
            });

        this.listElement =
            listWrapper.createEl('div', {
                cls: 'fl-focus-list'
            });

        this.emptyElement =
            listWrapper.createEl('div', {
                cls:
                    'fl-widget-result-placeholder',

                text:
                    getWidgetDefinitionEmptyState(this.definition)
            });

        this.configureDropTarget(
            wrapper
        );
    }


    // ============================================================
    // DRAG & DROP
    // ============================================================

    private configureDropTarget(
        container: HTMLElement
    ): void {

        const transfer =
            this.definition.transfer;

        if (
            !transfer?.inputs?.includes('text')
        ) {
            return;
        }

        const dragDrop =
            FolderLabDragDrop.getInstance(
                this.app
            );

        this.dropCleanup =
            dragDrop.registerTextDropTarget(
                container,

                async payload => {

                    if (!this.context?.activeFile) {
                        return;
                    }

                    const source = payload.source;



                    // ----------------------------------------------------------
                    // TRANSFERENCIA INTERNA
                    // ----------------------------------------------------------

                    if (source) {

                        // Misma instancia → no hacer nada.
                        if (
                            source.widgetId === this.id &&
                            source.instanceId === this.getInstanceId()
                        ) {
                            return;
                        }
                    }

                    const text =
                        payload.text.trim();

                    if (!text) {
                        return;
                    }

                    // ----------------------------------------------------------
                    // CREAR ELEMENTO EN EL DESTINO
                    // ----------------------------------------------------------

const item = {
    text,

    [
        this.definition.state?.field ??
        'active'
    ]:
        this.definition.state?.initial ??
        false
};

                    await this.controller.storage.add(
                        this.getStorageKey(),
                        this.context.activeFile.path,
                        this.getInstanceId(),
                        item
                    );

                    // ----------------------------------------------------------
                    // ELIMINAR ORIGEN SI ES TRANSFERENCIA INTERNA
                    // ----------------------------------------------------------

                    if (source) {

                        await this.controller.storage.delete(
                            source.widgetId,
                            this.context.activeFile.path,
                            source.instanceId,
                            source.itemId
                        );
                    }

                    await this.reload();

                    new Notice(
                        source
                            ? i18n.t('widgets.declarative.notice.movedTo', { label: this.label })
                            : i18n.t('widgets.declarative.notice.addedTo', { label: this.label })
                    );
                },

                active => {
                    container.toggleClass(
                        'fl-dnd-drop-active',
                        active
                    );
                }
            );
    }


    private renderTextInput(
        container: HTMLElement
    ): void {

        const inputArea =
            container.createEl('div', {
                cls: 'fl-tasks-input-area'
            });

        const input =
            inputArea.createEl('input', {
                cls: 'fl-tasks-input',
                type: 'text',
                placeholder:
                    getWidgetDefinitionPlaceholder(this.definition)
            });

        input.addEventListener(
            'keydown',
            event => {

                if (event.key !== 'Enter') {
                    return;
                }

                const text =
                    input.value.trim();

                if (!text || !this.context?.activeFile) {
                    return;
                }

                input.value = '';

                const stateField =
                    this.definition.state?.field;

const item: WidgetRecord = {
    title: text,

    text,

    ...(stateField
        ? {
            [stateField]:
                this.definition.state?.initial ??
                false
        }
        : {})
};

                // L3b: el listener devuelve void; la persistencia y
                // la recarga se ejecutan y sus errores se registran.
                void (async () => {
                    await this.controller.storage.add(
                        this.getStorageKey(),
                        this.context!.activeFile!.path,
                        this.getInstanceId(),
                        item
                    );

                    await this.reload();

                    input.focus();
                })().catch((error) => {
                    console.error(
                        '[FolderLab] Error añadiendo elemento:',
                        error
                    );
                });
            }
        );
    }

    // ============================================================
    // DATA
    // ============================================================

    private async reload(): Promise<void> {

        if (
            !this.context?.activeFile ||
            !this.listElement ||
            !this.emptyElement
        ) {
            return;
        }

        const data =
            await this.controller.storage.get(
                this.getStorageKey(),
                this.context.activeFile.path,
                this.getInstanceId()
            );

        this.items =
            Array.isArray(data.items)
                ? data.items
                : [];

        this.renderItems();
        this.updateCounter();
    }


    private renderItems(): void {

        if (
            !this.listElement ||
            !this.emptyElement
        ) {
            return;
        }

        this.listElement.empty();

        if (this.items.length === 0) {

            this.listElement.addClass('is-hidden');
            this.emptyElement.removeClass('is-hidden');

            return;
        }

        this.listElement.removeClass('is-hidden');
        this.emptyElement.addClass('is-hidden');

        const ordered =
            this.controller.ordering.sort(
                this.items,
                this.definition.ordering ?? {}
            );

        for (const item of ordered) {
            this.renderItem(item);
        }
    }


    // ============================================================
    // ITEM
    // ============================================================

    private renderItem(
        itemData: Record<string, any>
    ): void {

        if (!this.listElement) {
            return;
        }

        const stateField =
            this.definition.state?.field;

        const stateValue =
            stateField
                ? itemData[stateField]
                : true;

        const active =
            this.definition.state?.activeWhen
                ? stateValue ===
                this.definition.state.activeWhen.value
                : Boolean(stateValue);


        const selection =
            this.definition.selection;

        const isSelected =
            selection?.mode === 'single' &&
                selection.field
                ? itemData[selection.field] === true
                : false;


        /*
         * Participación declarada en el Board (transfer.board):
         * 'context' → el widget aporta contexto pero sus elementos
         * NO se arrastran; ausente/'composition' → drag permitido
         * cuando el widget declara outputs.
         */
        const boardPolicy =
            this.definition.transfer?.board;

        const canTransferToBoard =
            boardPolicy?.participation !== 'context' &&
            Boolean(
                this.definition.transfer?.outputs
                    ?.includes('text')
            );



        const listItem =
            new FocusListItem(
                this.listElement,
                {
                    state:
                        active
                            ? 'active'
                            : 'inactive',

                    primaryAction: {
                        id:
                            selection?.mode === 'single'
                                ? 'select'
                                : 'toggle',

                        label:
                            selection?.mode === 'single'
                                ? (
                                    isSelected
                                        ? i18n.t('widgets.declarative.action.candidateSelected')
                                        : i18n.t('widgets.declarative.action.selectCandidate')
                                )
                                : (
                                    active
                                        ? i18n.t('widgets.declarative.action.deactivate')
                                        : i18n.t('widgets.declarative.action.activate')
                                ),

                        onClick: () => {

                            // L3b: el callback de control devuelve
                            // void; se gestiona el rechazo.
                            void (async () => {
                                if (
                                    selection?.mode === 'single' &&
                                    selection.field
                                ) {

                                    await this.controller.selection.select(
                                        this.getStorageKey(),
                                        this.context!.activeFile!.path,
                                        this.getInstanceId(),
                                        itemData.id,
                                        selection.field
                                    );

                                } else if (stateField) {

                                    await this.controller.state.toggle(
                                        this.getStorageKey(),
                                        this.context!.activeFile!.path,
                                        this.getInstanceId(),
                                        itemData.id,
                                        stateField
                                    );
                                }

                                await this.reload();
                            })().catch((error) => {
                                console.error(
                                    '[FolderLab] Error actualizando elemento:',
                                    error
                                );
                            });
                        }
                    },



                    deleteAction: {
                        id: 'delete',

                        label:
                            i18n.t('actions.deleteElement'),

                        onClick: () => {

                            void (async () => {
                                await this.controller.storage.delete(
                                    this.getStorageKey(),
                                    this.context!.activeFile!.path,
                                    this.getInstanceId(),
                                    itemData.id
                                );

                                await this.reload();
                            })().catch((error) => {
                                console.error(
                                    '[FolderLab] Error eliminando elemento:',
                                    error
                                );
                            });
                        }
                    }


                }
            );

        const content =
            listItem.getContentElement();

        content.addClass(
            'fl-list-item-content'
        );

        if (canTransferToBoard) {
            content.setAttr(
                'draggable',
                'true'
            );
        }

        const entityContent =
            this.definition.entity?.content;

        const textField =
            entityContent?.fields?.[0] ??
            'text';

        const text =
            String(
                itemData[textField] ?? ''
            );

        const expandable =
            createExpandableText(
                content,
                text,

                {
                    initiallyExpanded: false,

                    previewLines:
                        entityContent?.previewLines ??
                        3,

                    expandedLabel: i18n.t('widgets.common.collapse'),
                    collapsedLabel: i18n.t('widgets.common.expand'),

                    editable:
                        entityContent?.editable ??
                        false,

                    rootClass:
                        `fl-${this.id}-expandable`,

                    contentClass:
                        `fl-${this.id}-expandable-content`,

                    actionClass:
                        `fl-${this.id}-expandable-action`,

                    onExpandedChange: (expanded) => {
                        listItem.setExpanded(expanded);
                    },
                }
            );

        // ----------------------------------------------------------
        // PERSISTENCIA DE EDICIONES EN LÍNEA
        //
        // Los widgets con entity.content.editable (p. ej. Tareas)
        // permiten editar el texto en el contenido. Sin este
        // guardado, la edición se perdía con la próxima recarga
        // (onChange → reload) y siempre al reiniciar Obsidian.
        // ----------------------------------------------------------

        if (entityContent?.editable) {

            const persistEdit = async (): Promise<void> => {

                const newText =
                    expandable.content.innerText;

                if (
                    newText === text ||
                    !this.context?.activeFile
                ) {
                    return;
                }

                await this.controller.storage.update(
                    this.getStorageKey(),
                    this.context.activeFile.path,
                    this.getInstanceId(),
                    itemData.id,
                    { [textField]: newText }
                );
            };

            expandable.content.addEventListener(
                'input',
                () => { void persistEdit(); }
            );

            expandable.content.addEventListener(
                'blur',
                () => { void persistEdit(); }
            );
        }

        // ----------------------------------------------------------
        // OUTPUT TRANSFER
        // ----------------------------------------------------------

        if (canTransferToBoard) {

            const dragDrop =
                FolderLabDragDrop.getInstance(
                    this.app
                );

            content.addEventListener(
                'dragstart',
                event => {

                    const dataTransfer =
                        event.dataTransfer;

                    if (!dataTransfer) {
                        return;
                    }

                    const payload = {
                        kind: 'text' as const,
                        text,

                        source: {
                            widgetId: this.id,
                            instanceId:
                                this.getInstanceId(),
                            itemId:
                                itemData.id
                        }
                    };

                    dragDrop.setActiveDragSource(
                        payload.source
                    );

                    dataTransfer.setData(
                        'application/x-folder-lab',
                        JSON.stringify(payload)
                    );

                    dataTransfer.setData(
                        'text/plain',
                        text
                    );

                    dataTransfer.effectAllowed =
                        'move';

                    content.addClass(
                        'is-dragging'
                    );
                }
            );

            content.addEventListener(
                'dragend',
                () => {

                    content.removeClass(
                        'is-dragging'
                    );

                    dragDrop.clearActiveDragSource();
                }
            );
        }
    }

    // ============================================================
    // METRICS
    // ============================================================



    private updateCounter(): void {

        if (!this.controlsHandle) {
            return;
        }

        const statusControl =
            this.definition.controls?.find(
                control =>
                    control.type === 'status' &&
                    control.id
            );

        if (
            !statusControl ||
            statusControl.type !== 'status' ||
            !statusControl.id
        ) {
            return;
        }

        const stats =
            this.getMetrics();

        const metricId =
            statusControl.metric ?? 'total';

        const value =
            stats[metricId] ?? 0;

        this.controlsHandle.updateStatus(
            statusControl.id,
            {
                label:
                    value === 0
                        ? '0'
                        : `${value}`,

                state:
                    value === 0
                        ? 'success'
                        : 'default'
            }
        );
    }


    private getMetrics(): Record<string, number> {

        const items = this.items;

        const result: Record<string, number> = {};

        const metrics =
            this.definition.metrics ?? {};

        for (const [id, metric] of Object.entries(metrics)) {

            if (metric.type !== 'count') {
                continue;
            }

            if (!metric.field) {
                result[id] = items.length;
                continue;
            }

            result[id] =
                items.filter(
                    item =>
                        item[metric.field!] === metric.value
                ).length;
        }

        return result;
    }


    // ============================================================
    // EMPTY
    // ============================================================

    private renderEmpty(
        text: string
    ): void {

        if (!this.container) {
            return;
        }

        this.container.createEl('div', {
            cls: 'fl-widget-empty'
        }).createEl('div', {
            cls: 'fl-widget-empty-text',
            text
        });
    }
}


// ============================================================
// FACTORY
// ============================================================

export class DeclarativeWidgetFactory
    implements FocusWidgetFactory {

    readonly widgetId: string;


    constructor(
        private readonly definition: WidgetDefinition,
        private readonly controller: WidgetController,
        private readonly app: App
    ) {
        this.widgetId =
            definition.id;
    }

    create(
        instanceId?: string
    ): FocusWidget {
        return new DeclarativeWidget(
            this.definition,
            this.controller,
            this.app,
            instanceId
        );
    }
}