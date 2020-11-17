const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const CMenu = imports.gi.CMenu;
const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const Util = imports.misc.util;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const {getDocManager} = imports.misc.docInfo;
const Mainloop = imports.mainloop;
const {heightsUsedMonitor} = imports.ui.panel;
//const {SessionManager} = imports.misc.gnomeSession;
const {ScreenSaverProxy} = imports.misc.screenSaver;
const {PopupMenuManager, PopupMenuSection} = imports.ui.popupMenu;
const {getAppFavorites} = imports.ui.appFavorites;
const {TextIconApplet, AllowedLayout, AppletPopupMenu} = imports.ui.applet;
const {AppletSettings} = imports.ui.settings;
const {addTween} = imports.ui.tweener;
const {Tooltip} = imports.ui.tooltips;
const {SignalManager} = imports.misc.signalManager;
const {launch_all} = imports.ui.searchProviderManager;
const {_, APPTYPE, AppTypes, tryFn, searchStr} = require('./utils');
const ApplicationsViewModeLIST = 0, ApplicationsViewModeGRID = 1;
const REMEMBER_RECENT_KEY = 'remember-recent-files';
const {CategoryListButton, AppListGridButton, ContextMenu, GroupButton} = require('./buttons');
const {BookmarksManager} = require('./browserBookmarks');
const {EMOJI} = require('./emoji');
//const EMOJI = emojiJS.EMOJI;
//const HINT_TEXT = _('Type to search...');
const SEARCH_THRESHOLD = 0.45;
const PlacementTOP = 0, PlacementBOTTOM = 1, PlacementLEFT = 2, PlacementRIGHT = 3;
var time;

class CinnamenuApplet extends TextIconApplet {
    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);
        this.setAllowedLayout(AllowedLayout.BOTH);
        if (orientation === St.Side.BOTTOM || orientation === St.Side.TOP) {
            this.init = false;
            this.set_applet_label(_('Initializing'));
        }
        this.privacy_settings = new Gio.Settings({schema_id: 'org.cinnamon.desktop.privacy'});
        this.appFavorites = getAppFavorites();
        this.recentEnabled = this.privacy_settings.get_boolean(REMEMBER_RECENT_KEY);
        this.favorites = this.appFavorites.getFavorites();
        this.appletReady = false;
        this.settings = {};
        this.searchActive = false;
        //this.searchWebErrorsShown = false;
        this.displayed = false;
        this.isNewInstance = true;
        this.currentCategory = 'all';
        this.gpu_offload_supported = Main.gpu_offload_supported;
        this.isBumblebeeInstalled = GLib.file_test('/usr/bin/optirun', GLib.FileTest.EXISTS);
        this.closeMenu = () => this.menu.close();
        this.orientation = orientation;
        this.menuManager = new PopupMenuManager(this);
        this.menu = new AppletPopupMenu(this, this.orientation);
        this.menuManager.addMenu(this.menu);
        this.menu.setCustomStyleClass('menu-background');
        this.menu.setCustomStyleClass('cinnamenu');
        this.signals = new SignalManager(null);
        this.displaySignals = new SignalManager(null);
        this.tracker = Cinnamon.WindowTracker.get_default();
        this.appSystem = Cinnamon.AppSystem.get_default();
        this.signals.connect(this.privacy_settings, 'changed::' + REMEMBER_RECENT_KEY, () =>
                                                                                this.onEnableRecentChange());
        this.signals.connect(Main.themeManager, 'theme-set', () => this.onThemeChanged());
        this.iconTheme = Gtk.IconTheme.get_default();
        this.signals.connect(this.iconTheme, 'changed', (...args) => this.onIconsChanged(...args));
        this.signals.connect(this.appSystem, 'installed-changed', (...args) => this.apps.installedChanged() );
        this.signals.connect(this.appFavorites, 'changed', (...args) => this.onFavoritesChanged(...args));
        this.signals.connect(this.menu, 'open-state-changed', (...args) => this.onOpenStateToggled(...args));
        //this.signals.connect(global, 'scale-changed', () => this.refresh() );
        this.categories = new Categories(this);
        this.apps = new Apps(this);
        this.allItems = [];
        this.lastRenderTime = 0;
        this.lastKeyEventTime = 0;
        //this.session = new SessionManager();
        this.screenSaverProxy = new ScreenSaverProxy();
        this.init = true;
        this.initSettings();
        this.isListView = this.settings.applicationsViewMode === ApplicationsViewModeLIST;
        this.onEnableBookmarksChange(null, true);
        this.updateIconAndLabel();
        this.updateActivateOnHover();
        this.updateKeybinding();

    }

    initSettings() {
        this.settingsObj = new AppletSettings(this.settings, __meta.uuid, this.instance_id);

        [
            { key: 'categories',                value: 'categories',            cb: null },//?undo
            { key: 'applications-view-mode',    value: 'applicationsViewMode',  cb: this.refresh },
            { key: 'description-placement',     value: 'descriptionPlacement',  cb: this.refresh },
            { key: 'sidebar-placement',         value: 'sidebarPlacement',      cb: this.refresh },
            { key: 'add-favorites',             value: 'addFavorites',          cb: this.refresh },
            { key: 'enable-custom-menu-height', value: 'enableCustomMenuHeight',cb: this.updateMenuHeight },
            { key: 'custom-menu-height',        value: 'customMenuHeight',      cb: this.updateMenuHeight },
            { key: 'apps-grid-column-count',    value: 'appsGridColumnCount',   cb: this.refresh },

            { key: 'show-places',               value: 'showPlaces',            cb: this.onEnablePlacesChange },
            { key: 'enable-bookmarks',          value: 'enableBookmarks',       cb: this.onEnableBookmarksChange },
            { key: 'show-favs-category',        value: 'showFavsCategory',      cb: this.onEnableFavsCategory },
            { key: 'enable-home-folder',        value: 'showHomeFolder',        cb: this.onEnableHomeFolderChange },

            { key: 'overlay-key',               value: 'overlayKey',            cb: this.updateKeybinding },
            { key: 'activate-on-hover',         value: 'activateOnHover',       cb: this.updateActivateOnHover },
            { key: 'hover-delay',               value: 'hoverDelayMs',
                            cb: () => { this.updateActivateOnHover(false);
                                        this.updateActivateOnHover(true); } },
            { key: 'enable-animation',          value: 'enableAnimation',       cb: null },
            { key: 'open-on-favorites',         value: 'openOnFavorites',       cb: null },

            { key: 'category-click',            value: 'categoryClick',         cb: null },
            { key: 'enable-autoscroll',         value: 'enableAutoScroll',      cb: this.refresh },
            { key: 'web-search-option',         value: 'webSearchOption',       cb: null },
            { key: 'emoji-search',              value: 'enableEmojiSearch',     cb: null },
            { key: 'enable-search-providers',   value: 'enableSearchProviders', cb: null },

            { key: 'menu-icon-custom',          value: 'menuIconCustom',        cb: this.updateIconAndLabel },
            { key: 'menu-icon',                 value: 'menuIcon',              cb: this.updateIconAndLabel },
            { key: 'menu-label',                value: 'menuLabel',             cb: this.updateIconAndLabel },

            { key: 'category-icon-size',        value: 'categoryIconSize',      cb: this.refresh },
            { key: 'apps-list-icon-size',       value: 'appsListIconSize',      cb: this.refresh },
            { key: 'apps-grid-icon-size',       value: 'appsGridIconSize',      cb: this.refresh },
            { key: 'session-icon-size',         value: 'sessionIconSize',       cb: this.refresh },
            { key: 'use-box-style',             value: 'useBoxStyle',           cb: this.refresh }
        ].forEach( setting => this.settingsObj.bind(
                          setting.key,
                          setting.value,
                          setting.cb ? (...args) => setting.cb.call(this, ...args) : null ) );
    }

    getGridWidth() {
        //if (!this.state) return 0;
        //size grid so that column widths are slightly wider when there are fewer columns
        let width = (this.settings.appsGridColumnCount * 130 + 80) * global.ui_scale;
        //bigger if large icons
        width = Math.max(width, this.getIconSize() * this.settings.appsGridColumnCount * 1.5);
        //ensure column width is a integer.
        width = Math.round(width / this.settings.appsGridColumnCount) * this.settings.appsGridColumnCount;
        return width;
    }

    getIconSize() {
        if (this.settings.applicationsViewMode === ApplicationsViewModeLIST) {
            return this.settings.appsListIconSize;
        } else {
            return this.settings.appsGridIconSize;
        }
    }

    getThemeForegroundColor() {
        const appletMenuThemeNode = this.menu.actor.get_theme_node();
        return appletMenuThemeNode.get_foreground_color().to_string().substring(0, 7);
    }
//--------------------------
    on_applet_reloaded() {
        /*if (!this.state) {
            return;
        }*/
    }

    on_orientation_changed(orientation) {
        this.orientation = orientation;
        if (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT) {
            this.hide_applet_label(true);
        } else {
            this.hide_applet_label(false);
        }
        this.updateIconAndLabel();
        //this.refresh();
    }

    on_applet_added_to_panel() {
        if (!this.menu) { //??
            return;
        }
        this.appletReady = true;
    }

    on_applet_removed_from_panel() {
        this.willUnmount = true;
        Main.keybindingManager.removeHotKey('overlay-key-' + this.instance_id);
        if (!this.settingsObj) {
            return;
        }
        this.settingsObj.finalize();
        this.signals.disconnectAllSignals();
        this.apps.destroy();
        this.destroyAppButtons();
        if (!this.appsView) {
            this.destroyDisplayed();
        }
        this.menu.destroy();
    }

    on_applet_clicked() {
        if (!this.init) {
            this.set_applet_label(_('Please wait...'));
            return;
        }
        this.menu.toggle_with_options(this.settings.enableAnimation);
    }

    on_panel_height_changed() {
        //this.refresh();
    }

    on_applet_instances_changed(instance) {
      if (instance && instance.instance_id !== this.instance_id) {
          this.getOtherInstance = () => instance;
          instance.getOtherInstance = () => this;
      } else if (!instance && !this.willUnmount) {
          this.getOtherInstance = null;
      }
    }

    launchPrivacySettings() {
        Util.spawnCommandLine('cinnamon-settings privacy');
    }

    launchEditor() {
        Util.spawnCommandLine('cinnamon-menu-editor');
    }

    updateKeybinding() {
        Main.keybindingManager.addHotKey(
            'overlay-key-' + this.instance_id,
            this.settings.overlayKey,
            () => {
                if (Main.overview.visible || Main.expo.visible) return;
                if (!this.getOtherInstance || global.screen.get_current_monitor() === this.panel.monitorIndex) {
                    this.menu.toggle_with_options(this.settings.enableAnimation);
                } else if (typeof this.getOtherInstance === 'function') {
                    const instance = this.getOtherInstance();
                    instance.menu.toggle_with_options.call(instance.menu, instance.settings.enableAnimation);
                }
            }
        );
    }

    updateIconAndLabel() {
        tryFn(() => {
            if (this.settings.menuIconCustom) {
                if (this.settings.menuIcon === '') {
                    this.set_applet_icon_name('');
                } else if (GLib.path_is_absolute(this.settings.menuIcon) &&
                                    GLib.file_test(this.settings.menuIcon, GLib.FileTest.EXISTS)) {
                    if (this.settings.menuIcon.includes('-symbolic')) {
                        this.set_applet_icon_symbolic_path(this.settings.menuIcon);
                    } else {
                        this.set_applet_icon_path(this.settings.menuIcon);
                    }
                } else if (this.iconTheme.has_icon(this.settings.menuIcon)) {
                    if (this.settings.menuIcon.includes('-symbolic')) {
                        this.set_applet_icon_symbolic_name(this.settings.menuIcon);
                    } else {
                        this.set_applet_icon_name(this.settings.menuIcon);
                    }
                }
            } else {
                this.set_applet_icon_path(__meta.path + '/icon.png');
                /*let iconName = global.settings.get_string('app-menu-icon-name');*/
            }
        }, () => {
            global.logWarning('Could not load icon file ' + this.settings.menuIcon + ' for menu button');
        });

        if (this.settings.menuIconCustom && this.settings.menuIcon === '') {
            this._applet_icon_box.hide();
        } else {
            this._applet_icon_box.show();
        }

        if (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT) {
            this.set_applet_label('');
        } else {
            if (!this.panelMenuLabelText || this.panelMenuLabelText.length > 0) {
                if (!this.settings.menuLabel) {
                    this.settings.menuLabel = '';
                }
                this.set_applet_label(this.settings.menuLabel);
                this.set_applet_tooltip(this.settings.menuLabel);
            } else {
                this.set_applet_label('');
            }
        }
    }

    onEnableRecentChange() {
        this.recentEnabled = this.privacy_settings.get_boolean(REMEMBER_RECENT_KEY);
        this.categories.buildCategories();
        if (this.currentCategory === 'recents' && !this.settings.recentEnabled) {
            this.currentCategory = 'all';
        }
    }

    onEnablePlacesChange() {
        this.categories.buildCategories();
        if (this.currentCategory === 'places' && !this.settings.showPlaces) {
            this.currentCategory = 'all';
        }
    }

    onEnableFavsCategory() {
        this.categories.buildCategories();
        if (this.currentCategory === 'favorites' && !this.settings.showFavsCategory) {
            this.currentCategory = 'all';
        }
    }

    onEnableHomeFolderChange() {
        this.categories.buildCategories();
    }

    onEnableBookmarksChange(enabled, fromInit = false) { //web bookmarks
        if (this.settings.enableBookmarks) {
            this.bookmarksManager = new BookmarksManager(this.appSystem);
        } else if (this.bookmarksManager) {
            this.bookmarksManager = null;
        }
        if (!fromInit) {
            this.categories.buildCategories();
            if (this.currentCategory === 'bookmarks' && !this.settings.enableBookmarks) {
                this.currentCategory = 'all';
            }
        }
    }

    updateActivateOnHover(activate = true) {
        const openMenu = () => {
            if (!this._applet_context_menu.isOpen) {
                this.menu.open(this.settings.enableAnimation);
            }
        };

        if (this.settings.activateOnHover && activate) {
            this.signals.connect(this.actor, 'enter-event', () => {
                        setTimeout(() => openMenu(), this.settings.hoverDelayMs); });
        } else if (this.signals.isConnected('enter-event', this.actor)) {
            this.signals.disconnect('enter-event', this.actor);
        }
    }

    onFavoritesChanged() {
        this.favorites = this.appFavorites.getFavorites();
        // Check if the menu has been rendered at least once
        if (this.appsView) {
            this.sessionBox.populate(this.apps.listFavorites());
            this.setActiveCategory(this.currentCategory);
            this.updateMenuHeight();
            this.updateMenuWidth();
        }

        /*
        Mainloop.idle_add_full(150, () => {
                if (this.dragging) {
                    const button = Util.find(this.allItems, (item) => item.app.appIndex === this.dragIndex);
                    if (button) {
                        this.scrollToButton(button);
                    }
                    //this.resetOpacity();
                    this.dragging = false;
                } });*/
    }

    onIconsChanged() {
        if (!this.menu || !this.appletReady) {
            return;
        }
    }

    onThemeChanged() {
        this.updateIconAndLabel();
        setTimeout(() => this.refresh(), 0);
    }

    resetCategoryOrder() {//?undo
        if (!this.categoriesView) {
            return;
        }
        this.settings.categories = [];
        this.categories.buildCategories();
    }
//==================================================================
    addCategoryFolder() {

    }

    addFavoriteToPos(add_id, pos_id) {
        const pos = this.appFavorites._getIds().indexOf(pos_id);
        if (pos >= 0) { //move
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                                    this.appFavorites.moveFavoriteToPos(add_id, pos);
                                    return false; });
        } else {
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                                    this.appFavorites.addFavoriteAtPos(add_id, pos);
                                    return false; });
        }
    }

    moveCategoryToPos(id1, id2) { //?undo
        let categories = this.settings.categories.slice();
        let oldIndex = categories.indexOf(id1);
        let newIndex = categories.indexOf(id2);
        categories.splice(oldIndex, 1);
        let categories1 = categories.slice(0, newIndex);
        let categories2 = categories.slice(newIndex, categories.length);
        categories = categories1.concat([id1]).concat(categories2);
        this.settings.categories = categories;
        this.resetCategoryOpacity();
        this.categories.buildCategories();
        this.categoryButtons.forEach( categoryButton => {
                                            if (categoryButton.id === id2) {
                                                categoryButton.handleEnter();
                                            } else if (categoryButton.entered) {
                                                categoryButton.handleLeave();
                                            } });

        this.setActiveCategory(this.currentCategory);
    }

    resetOpacity() {
        this.appsView.getActiveContainer().get_children().forEach( child => child.set_opacity(255) );
    }

    resetCategoryOpacity() {
        this.categoryButtons.forEach( (button) => button.actor.set_opacity(255) );
    }

    scrollToButton(button, fullyScrollFirstAndLast = false) {
        let container = button.actor.get_parent();
        let scrollBox = container;
        let children;
        let i = 0;
        while (!(scrollBox instanceof St.ScrollView)) {
            i++;
            if (i > 10) {
                global.logWarning('Cinnamenu: Unable to find scrollbox for', button.actor.toString());
                return false;
            }
            scrollBox = scrollBox.get_parent();
        }

        let adjustment = scrollBox.vscroll.adjustment;
        let [value, lower, upper, stepIncrement, pageIncrement, pageSize] = adjustment.get_values();

        if (fullyScrollFirstAndLast) children = container.get_children();
        if (fullyScrollFirstAndLast && button.actor === children[0]) {
            value = 0;
        } else if (fullyScrollFirstAndLast && button.actor === children[children.length - 1]) {
            value = scrollBox.height;
        } else {
            let offset = 0;
            const vfade = scrollBox.get_effect('fade');
            if (vfade) {
                offset = vfade.vfade_offset;
            }
            const box = button.actor.get_allocation_box();
            let y1 = box.y1, y2 = box.y2;
            let parent = button.actor.get_parent();
            while (parent !== scrollBox) {
                if (!parent) {
                    return false;
                }
                const box = parent.get_allocation_box();
                y1 += box.y1;
                y2 += box.y1;
                parent = parent.get_parent();
            }
            if (y1 < value + offset) {
                value = Math.max(0, y1 - offset);
            } else if (y2 > value + pageSize - offset) {
                value = Math.min(upper, y2 + offset - pageSize);
            } else {
                return false;
            }
        }

        if (this.settings.enableAnimation) {
            addTween(adjustment, { value: value, time: 0.1, transition: 'easeOutQuad' });
        } else {
            adjustment.set_value(value);
        }
    }

    clearEnteredActors() {
        if (this.contextMenu.isOpen) {
            this.contextMenu.close();
        }
        this.appsView.clearEnteredActors();
        this.sessionBox.clearEnteredActors();
    }
//----------
    onOpenStateToggled(menu, open) {
        if (global.settings.get_boolean('panel-edit-mode')) {
            return false;
        }
        if (open) {
            if (!this.displayed) {
                this.display();
            }

            global.stage.set_key_focus(this.search.searchEntry);
            this.mainBox.show();
            let currentCategory = this.settings.openOnFavorites && this.settings.showFavsCategory ?
                                                                        'favorites' : this.currentCategory;
            this.updateMenuWidth();
            //Mainloop.idle_add_full(Mainloop.PRIORITY_DEFAULT, () => this.updateMenuHeight());
            Mainloop.idle_add_full(Mainloop.PRIORITY_DEFAULT, () => this.setActiveCategory(currentCategory));
            Mainloop.idle_add_full(Mainloop.PRIORITY_DEFAULT, () => this.updateMenuHeight());
        } else {
            if (this.searchActive) {
                this.allItemsCleanup();
                this.search.searchEntry.set_text('');
                this.searchActive = false;
            }
            this.clearEnteredActors();
            //Mainloop.idle_add_full(Mainloop.PRIORITY_DEFAULT, () => this.allItemsDelete());
            //this.appsView.clear();
        }
        return true;
    }

    updateMenuHeight() {
        let menuHeight;
        const monitorHeight = Main.layoutManager.monitors[this.panel.monitorIndex].height;
        const [toppanelHeight,bottompanelHeight] = heightsUsedMonitor(this.panel.monitorIndex,
                                                                                    Main.panelManager.panels);
        const customHeightLimit = monitorHeight - toppanelHeight - bottompanelHeight;
        //let customHeightLimit = monitorHeight - 120;
        if (this.settings.enableCustomMenuHeight) {
            menuHeight = Math.min(this.settings.customMenuHeight * global.ui_scale, customHeightLimit);
        } else {
            menuHeight = this.categoriesView.categoriesBox.height + this.bottomPane.height;
            menuHeight = Math.min(menuHeight, customHeightLimit);
        }
        const appsHeight = /*Math.max(this.sessionBox.box.height,*/ menuHeight - this.bottomPane.height;
        this.appsView.applicationsScrollBox.height = appsHeight;
        this.categoriesView.groupCategoriesWorkspacesScrollBox.height = appsHeight;
        this.sessionBox.sessionScrollBox.set_height(-1);
        this.sessionBox.sessionScrollBox.set_height(
                                        Math.min(appsHeight, this.sessionBox.sessionScrollBox.height));
        //this.applicationsScrollBox.style = `max-height: ${appsHeight}px;`;
    }

    updateMenuWidth() {
        const searchWidth = this.search.searchBox.width - this.categoriesView.categoriesBox.width;
        this.search.searchEntry.width = searchWidth > 0 ? searchWidth : this.search.searchEntry.width;
        if (this.isListView) {
            this.appBoxWidth = Math.max(320, this.bottomPane.width -
                                        this.categoriesView.groupCategoriesWorkspacesScrollBox.width);
            this.appsView.applicationsListBox.width = this.appBoxWidth;
            //global.log('appboxwidth',this.appBoxWidth,this.bottomPane.width,
            //                            this.categoriesView.groupCategoriesWorkspacesScrollBox.width);
        }
        //this.actor.style += `max-width: ${this.mainBox.width}px;`;//` max-height: ${this.mainBox.height}px;`;
    }

    refresh() {
        // TBD: For some reason the onEnable* settings callbacks get called several times per settings change,
        // This is causing the start up category to reset, so throttling this function to 250ms prevents excess
        // invocation.
        const now = Date.now();
        if ((now - this.lastRenderTime) <= 250) return;
        this.lastRenderTime = now;
        this.menu.removeAll();
        this.destroyDisplayed();
        this.categoryButtons = [];
        if (this.currentCategory === 'places' && !this.settings.showPlaces ||
                        this.currentCategory === 'bookmarks' && !this.settings.enableBookmarks ||
                        this.currentCategory === 'recents' && !this.recentEnabled ||
                        this.currentCategory === 'favorites' && !this.settings.showFavsCategory) {
            this.currentCategory = 'all';
        }
        this.display();
        this.clearEnteredActors();
        this.destroyAppButtons();
    }

    setActiveCategory(categoryId) {
        if (this.willUnmount) {
            return;
        }
        this.currentCategory = categoryId;
        this.categoryButtons.forEach(categoryButton => {
                        if (categoryButton.id === categoryId) {
                            categoryButton.actor.set_style_class_name('menu-category-button-selected');
                        } else {
                            categoryButton.actor.set_style_class_name('menu-category-button');
                        } } );
        /*if (categoryId.startsWith('/')) {
            const homeFolderIndex = Util.find(this.categoryButtons, (button) => button.id == '/home/fred');
            if (homeFolderIndex) {
                this.categoryButtons[homeFolderIndex].actor.set_style_class_name('menu-category-button-selected');
            }
        }*/
        this.allItemsCleanup();
        this.appsView.clear();
        switch (categoryId) {
            case 'places':
                this.populateAppsBox(this.apps.listPlaces());
                break;
            case 'recents':
                const recents = this.apps.listRecent();
                this.populateAppsBox(recents);
                if (recents.length === 0) {
                    this.appsView.setAnswerText(_('No recent files'));
                }
                break;
            case 'bookmarks':
                this.populateAppsBox(this.apps.listWebBookmarks());
                break;
            case 'favorites':
                this.populateAppsBox(this.apps.listFavorites());
                break;
            default:
                if (categoryId.startsWith('/')) {
                    this.appsView.setAnswerText(categoryId);
                    this.populateAppsBox(this.apps.listFolder(categoryId));
                } else {
                    this.populateAppsBox(this.apps.listApplications(categoryId));
                }
        }
    }

    /*isNotInScrollView(button) {
        const adjustment = this.applicationsScrollBox.get_vscroll_bar().get_adjustment();
        const currentScrollValue = adjustment.get_value();
        const boxHeight = this.applicationsScrollBox.get_allocation_box().y2 -
                                                        this.applicationsScrollBox.get_allocation_box().y1;
        const allocationBox = button.actor.get_allocation_box();
        return boxHeight + currentScrollValue < allocationBox.y2 + 100;
    }*/

    onMenuKeyPress(actor, event) {
        let symbol = event.get_key_symbol();

        let keyCode = event.get_key_code();
        let modifierState = Cinnamon.get_event_state(event);

        /* check for a keybinding and quit early, otherwise we get a double hit
           of the keybinding callback */
        let action = global.display.get_keybinding_action(keyCode, modifierState);

        if (action === Meta.KeyBindingAction.CUSTOM) {
            return Clutter.EVENT_PROPAGATE;
        }

        const ctrlKey = modifierState & Clutter.ModifierType.CONTROL_MASK || symbol === 65507 || symbol === 65508;
        const shiftKey = modifierState === 1;
        const altKey = modifierState === 8;
        const altgrKey = modifierState === 128;
        const noModifiers = modifierState === 0;

        //Ignore duplicate event emitted by ibus.
        const now = Date.now();
        if ((symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) && noModifiers
                                                                && (now - this.lastKeyEventTime) <= 100) {
            return Clutter.EVENT_PROPAGATE;
        }
        this.lastKeyEventTime = now;

        const powerGroupButtons = this.sessionBox.getButtons();

        let buttons = this.appsView.getActiveButtons();

        let refItemIndex = buttons.findIndex( (button) =>
                        button.actor.has_style_class_name('menu-application-button-selected') ||
                                                                        button.entered != null );

        let refCategoryIndex = this.categoryButtons.findIndex( (button) => button.entered != null );
        if (refCategoryIndex < 0) {

            refCategoryIndex = this.categoryButtons.findIndex( (button) => this.currentCategory === button.id );
        }

        let refPowerGroupItemIndex = powerGroupButtons.findIndex( (button) => button.entered != null );

        let enteredItemExists = refItemIndex > -1 && buttons[refItemIndex] != null;
        let enteredCategoryExists = refCategoryIndex > -1 && this.categoryButtons[refCategoryIndex] != null;
        let enteredPowerGroupItemExists = refPowerGroupItemIndex > -1 &&
                                                            powerGroupButtons[refPowerGroupItemIndex] != null;

        let enteredContextMenuItemExists = false;
        let contextMenuChildren = [];
        let refContextMenuItemIndex = -1;
        if (this.contextMenu.isOpen) {
            contextMenuChildren = this.contextMenu.contextMenuButtons;
            refContextMenuItemIndex = contextMenuChildren.findIndex( (button) => button.entered != null );
            if (refContextMenuItemIndex < 0) {
                refContextMenuItemIndex = 0;
            }
            enteredContextMenuItemExists = true;
        }
        let startingCategoryIndex = this.categoryButtons.findIndex( (button) =>
                                                                    this.currentCategory === button.id);
        if (startingCategoryIndex < 0) {
            startingCategoryIndex = 0;
        }

        const leaveCurrentlyEnteredItem = () => {
            if (enteredContextMenuItemExists) {
                contextMenuChildren[refContextMenuItemIndex].handleLeave();
            } else if (enteredItemExists) {
                buttons[refItemIndex].handleLeave();
            } else if (enteredPowerGroupItemExists) {
                powerGroupButtons[refPowerGroupItemIndex].handleLeave();
            } else if (enteredCategoryExists) {
                this.categoryButtons[refCategoryIndex].handleLeave();
            }
        };

        const nextPowerGroupItem = () => {
            if (refPowerGroupItemIndex < powerGroupButtons.length - 1) {
                    powerGroupButtons[refPowerGroupItemIndex + 1].handleEnter();
            } else {
                powerGroupButtons[0].handleEnter();
            }
        };

        const previousPowerGroupItem = () => {
            if (refPowerGroupItemIndex === 0) {
                    powerGroupButtons[powerGroupButtons.length -1].handleEnter();
            } else {
                powerGroupButtons[refPowerGroupItemIndex - 1].handleEnter();
            }
        };

        const leftNavigation = () => {
            if (enteredContextMenuItemExists) {
                contextMenuChildren[refContextMenuItemIndex].handleEnter();//Ignore
            } else if (enteredPowerGroupItemExists) {
                if (this.settings.sidebarPlacement === PlacementLEFT ||
                                                this.settings.sidebarPlacement === PlacementRIGHT) {
                    this.categoryButtons[startingCategoryIndex].handleEnter();
                } else {
                    previousPowerGroupItem();
                }
            } else if (enteredItemExists) {
                if (this.isListView) {
                    this.categoryButtons[startingCategoryIndex].handleEnter();
                } else {
                    if (refItemIndex > 0) {
                        buttons[refItemIndex - 1].handleEnter();
                    } else {
                        buttons[buttons.length - 1].handleEnter();
                    }
                }
            } else if (enteredCategoryExists) {
                powerGroupButtons[0].handleEnter();
            }
        };

        const rightNavigation = () => {
            if (enteredContextMenuItemExists) {
                contextMenuChildren[refContextMenuItemIndex].handleEnter();//Ignore
            } else if (enteredPowerGroupItemExists) {
                if (this.settings.sidebarPlacement === PlacementLEFT ||
                                                    this.settings.sidebarPlacement === PlacementRIGHT) {
                    this.categoryButtons[startingCategoryIndex].handleEnter();
                } else {
                    nextPowerGroupItem();
                }
            } else if (enteredItemExists) {
                if (this.isListView) {
                    buttons[refItemIndex].handleEnter();//ignore
                } else {
                    if (buttons[refItemIndex + 1]) {
                        buttons[refItemIndex + 1].handleEnter();
                    } else {
                        buttons[0].handleEnter();
                    }
                }
            } else if (enteredCategoryExists) {
                buttons[0].handleEnter();
            }
        };

        const downNavigation = () => {
            if (enteredContextMenuItemExists) {
                if (contextMenuChildren[refContextMenuItemIndex + 1]) {
                    contextMenuChildren[refContextMenuItemIndex + 1].handleEnter();
                } else {
                    contextMenuChildren[0].handleEnter();
                }
            } else if (enteredPowerGroupItemExists) {
                if (this.settings.sidebarPlacement === PlacementTOP ||
                                                    this.settings.sidebarPlacement === PlacementBOTTOM) {
                    this.categoryButtons[startingCategoryIndex].handleEnter();
                } else {
                    nextPowerGroupItem();
                }
            } else if (enteredItemExists) {
                if (this.isListView) {
                    if (buttons[refItemIndex + 1]) {
                        buttons[refItemIndex + 1].handleEnter();
                    } else {
                        buttons[0].handleEnter();
                    }
                } else {//grid view
                    if (buttons[refItemIndex + this.settings.appsGridColumnCount]) {
                        buttons[refItemIndex + this.settings.appsGridColumnCount].handleEnter();
                    } else {
                        buttons[buttons.length - 1].handleEnter();
                    }
                }
            } else if (enteredCategoryExists) {
                if (this.categoryButtons[refCategoryIndex + 1]) {
                    this.categoryButtons[refCategoryIndex + 1].handleEnter();
                } else {
                    this.categoryButtons[0].handleEnter();
                }
            }
        };

        const upNavigation = () => {
            if (enteredContextMenuItemExists) {
                if (refContextMenuItemIndex > 0) {
                    contextMenuChildren[refContextMenuItemIndex - 1].handleEnter();
                } else {
                    contextMenuChildren[contextMenuChildren.length - 1].handleEnter();
                }
            } else if (enteredPowerGroupItemExists) {
                if (this.settings.sidebarPlacement === PlacementTOP ||
                                                this.settings.sidebarPlacement === PlacementBOTTOM) {
                    this.categoryButtons[startingCategoryIndex].handleEnter();
                } else {
                    previousPowerGroupItem();
                }
            } else if (enteredItemExists) {
                if (this.isListView) {
                    if (refItemIndex > 0) {
                        buttons[refItemIndex - 1].handleEnter();
                    } else {
                        buttons[buttons.length - 1].handleEnter();
                    }
                } else {
                    if (buttons[refItemIndex - this.settings.appsGridColumnCount]) {
                        buttons[refItemIndex - this.settings.appsGridColumnCount].handleEnter();
                    } else {
                        buttons[0].handleEnter();
                    }
                }
            } else if (enteredCategoryExists) {
                if (refCategoryIndex > 0) {
                    this.categoryButtons[refCategoryIndex - 1].handleEnter();
                } else {
                    this.categoryButtons[this.categoryButtons.length - 1].handleEnter();
                }
            }
        };

        const tabNavigation = () => {
            if (enteredContextMenuItemExists) {
                contextMenuChildren[refContextMenuItemIndex].handleEnter();//Ignore
            } else if (enteredItemExists) {
                powerGroupButtons[0].handleEnter();
            } else if (enteredPowerGroupItemExists && !this.searchActive) {
                this.categoryButtons[startingCategoryIndex].handleEnter();
            } else {
                buttons[0].handleEnter();
            }
        };

        const activateItem = () => {
            if (enteredContextMenuItemExists) {
                contextMenuChildren[refContextMenuItemIndex].activate();
            } else if (enteredItemExists) {
                buttons[refItemIndex].activate();
            } else if (enteredPowerGroupItemExists) {
                powerGroupButtons[refPowerGroupItemIndex].activate();
            } else if (enteredCategoryExists) {
                this.categoryButtons[refCategoryIndex].selectCategory();
            }
        };

        const activateContextMenu = () => {
            if (enteredContextMenuItemExists) {
                //Ignore
            } else if (enteredItemExists) {
                buttons[refItemIndex].openContextMenu();
            } else if (enteredPowerGroupItemExists) {
                powerGroupButtons[refPowerGroupItemIndex].openContextMenu();
            } else if (enteredCategoryExists) {
                //Ignore
            }
        };

        /*const moveCategory = (direction) => {
            if (!enteredItemExists && !enteredPowerGroupItemExists && !enteredContextMenuItemExists &&
                                                                                    enteredCategoryExists) {
                if (direction === "up" && refCategoryIndex > 0) {
                    this.state.trigger('moveCategoryToPos', this.categoryButtons[refCategoryIndex].id,
                                                        this.categoryButtons[refCategoryIndex - 1].id);
                    this.categoryButtons[refCategoryIndex - 1].handleEnter();
                } else if (direction === "down" && refCategoryIndex < this.categoryButtons.length - 1) {
                    this.state.trigger('moveCategoryToPos', this.categoryButtons[refCategoryIndex].id,
                                                        this.categoryButtons[refCategoryIndex + 1].id);
                    this.categoryButtons[refCategoryIndex + 1].handleEnter();
                }
            }
        };*/

        //global.log(modifierState, symbol);
        switch (true) {
            case symbol === Clutter.KP_Enter:
            case symbol === Clutter.KEY_Return:
                if (ctrlKey) {
                    activateContextMenu();
                } else if (noModifiers) {
                    activateItem();
                } else {
                    return Clutter.EVENT_PROPAGATE;
                }
            return Clutter.EVENT_STOP;
            case (symbol === Clutter.KEY_Menu && noModifiers):
                activateContextMenu();
                return Clutter.EVENT_STOP;
            case (symbol === Clutter.KEY_Up):
                leaveCurrentlyEnteredItem();
                upNavigation();
                return Clutter.EVENT_STOP;
            /*case (symbol === Clutter.KEY_Up && modifierState === 4)://ctrl up
                moveCategory("up");
                return true;*/
            case (symbol === Clutter.KEY_Down):
                leaveCurrentlyEnteredItem();
                downNavigation();
                return Clutter.EVENT_STOP;
            /*case (symbol === Clutter.KEY_Down && modifierState === 4)://ctrl down
                moveCategory("down");
                return true;*/
            case (symbol === Clutter.KEY_Right):
                leaveCurrentlyEnteredItem();
                rightNavigation();
                return Clutter.EVENT_PROPAGATE; //so that left/right can also be used to navigate search entry
            case (symbol === Clutter.KEY_Left):
                leaveCurrentlyEnteredItem();
                leftNavigation();
                return Clutter.EVENT_PROPAGATE;
            case symbol === Clutter.ISO_Left_Tab:
            case symbol === Clutter.Tab:
                if (modifierState === 8) {  //Alt-Tab was pressed. Close menu as alt-tab is
                                            //used for app-switcher in cinnamon
                    this.closeMenu();
                    return Clutter.EVENT_STOP;
                } if (noModifiers) {
                    leaveCurrentlyEnteredItem();
                    tabNavigation();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            case (symbol === Clutter.KEY_Escape && noModifiers):
            case (symbol === Clutter.Escape && noModifiers):
                if (this.contextMenu.isOpen) {
                    this.contextMenu.close();
                    //    buttons[refItemIndex].handleEnter();
                } else {
                    this.closeMenu();
                }
                return Clutter.EVENT_STOP;
            case symbol === Clutter.KEY_Page_Up:
                leaveCurrentlyEnteredItem();
                if (enteredItemExists) {
                    buttons[0].handleEnter();
                } else if (enteredPowerGroupItemExists) {
                    powerGroupButtons[0].handleEnter();
                } else {
                    this.categoryButtons[0].handleEnter();
                }
                return Clutter.EVENT_STOP;
            case symbol === Clutter.KEY_Page_Down:
                leaveCurrentlyEnteredItem();
                if (enteredItemExists) {
                    buttons[buttons.length - 1].handleEnter();
                } else if (enteredPowerGroupItemExists) {
                    powerGroupButtons[powerGroupButtons.length - 1].handleEnter();
                } else {
                    this.categoryButtons[this.categoryButtons.length - 1].handleEnter();
                }
                return Clutter.EVENT_STOP;
            default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    allItemsCleanup() {
        const allItems = this.allItems.filter( (item) => {
                        if (item.app.type === APPTYPE.provider || item.app.type === APPTYPE.file) {
                            item.destroy(true);
                            item = undefined;
                            return false;
                        } else {
                            //this.allItems[i].app.nameWithSearchMarkup = null;
                            //this.allItems[i].app.descriptionWithSearchMarkup = null;
                            //this.allItems[i].app.keywordsWithSearchMarkup = null;
                            //this.allItems[i].app.idWithSearchMarkup = null;
                            return true;
                        } });
        this.allItems = allItems;
    }

    allItemsDelete() {
        let allItems = [];
        for (let i = 0; i < this.allItems.length; i++) {
            if (!this.allItems[i]) {
              continue;
            }
            if (this.allItems[i].toBeDeleted) {
                this.allItems[i].destroy(true);
                this.allItems[i] = undefined;
            } else {
                /*this.allItems[i].app.nameWithSearchMarkup = null;
                this.allItems[i].app.descriptionWithSearchMarkup = null;
                this.allItems[i].app.keywordsWithSearchMarkup = null;
                this.allItems[i].app.idWithSearchMarkup = null;*/
                allItems.push(this.allItems[i]);
            }
        }
        this.allItems = allItems;
    }

    onSearchTextChanged() {
        const searchText = this.search.searchEntryText.get_text();

        if (searchText.length === 0) {
            this.allItemsCleanup();
            this.searchActive = false;
            this.categoryButtons.forEach(button => button.enable());
            this.setActiveCategory(this.currentCategory);
            if (this.signals.isConnected('secondary-icon-clicked', this.search.searchEntry)) {
                this.signals.disconnect('secondary-icon-clicked', this.search.searchEntry, this);
            }
            this.search.showSecondaryIcon(false);
            this.previousSearchPattern = '';
            return;
        }

        this.categoryButtons.forEach(button => button.disable());
        this.searchActive = true;
        this.currentSearchStr = searchText;
        this.appsView.setAnswerText(null);
        this.clearEnteredActors();
        this.search.showSecondaryIcon(true);
        if (!this.signals.isConnected('secondary-icon-clicked', this.search.searchEntry)) {
            this.signals.connect(this.search.searchEntry, 'secondary-icon-clicked', () => {
                                                        this.clearEnteredActors();
                                                        this.search.searchEntryText.set_text('');
                                                        this.onSearchTextChanged();
                                                        }, this);
        }
        setTimeout(() => this.doSearch(searchText), 0);
    }

    doSearch(text) {
        //this fuction has been called asynchronously meaning that a keypress may have changed the
        //search query before this function is called. Check that this search is still valid.
        if (text !== this.currentSearchStr) return;
        //if (!text || !text.trim()) return;
        let pattern = Util.latinise(text.toLowerCase());
        //Don't repeat the same search. This can happen if a key and backspace are pressed in quick
        //succession while a previous search is being carried out.
        if (pattern === this.previousSearchPattern) {
            return false;
        }
        this.previousSearchPattern = pattern;
        let results = this.apps.listApplications('all', pattern)
                            .concat(this.settings.showPlaces ? this.apps.listPlaces(pattern) : [])
                            .concat(this.settings.enableBookmarks ? this.apps.listWebBookmarks(pattern) : [])
                            .concat(this.recentEnabled ? this.apps.listRecent(pattern) : []);

        results.sort( (a, b) =>  a.score < b.score );
        if (results.length > 10) {
            results.length = 10;
        }
        //-----search providers-------
        //---calculator---
        //const exp = text.replace(/([a-zA-Z]+)/g,"Math.$&");
        const replacefn = (match) => {
            if (['E','PI','abs','acos','acosh','asin','asinh','atan','atanh','cbrt','ceil','cos',
            'cosh','exp','floor','fround','log','max','min','pow','random','round','sign','sin',
            'sinh','sqrt','tan','tanh','trunc'].includes(match)) {
                return "Math." + match;
            } else {
                validExp = false;
                return match;
            }
        };
        let validExp = true;
        let ans = null;
        const exp = text.replace(/([a-zA-Z]+)/g, replacefn);
        if (validExp) {
            ans = tryFn(()=>{ return eval(exp); }, null);
        }
        if ((typeof ans == 'number' || typeof ans == 'boolean') && ans != text ) {
            const calcIcon = Gio.file_new_for_path(__meta.path + '/calc.png');
            results.push({  type: APPTYPE.provider,
                            name: _('Solution:') + ' ' + ans,
                            description: _('Click to copy'),
                            icon: new St.Icon({ gicon: new Gio.FileIcon({ file: calcIcon }),
                                                                        icon_size: this.getIconSize() }),
                            activate: () => {   const clipboard = St.Clipboard.get_default();
                                                clipboard.set_text(St.ClipboardType.CLIPBOARD, ans.toString());}
                         });
        }
        //---web search option---
        if (this.settings.webSearchOption != 4) {//4=none
            const iconName = ['google_icon.png',"bing_icon.png",'yahoo_icon.png',
                                                'duckgo_icon.png'][this.settings.webSearchOption];
            const url = ['google.com/search?q=','www.bing.com/search?q=','search.yahoo.com/search?p=',
                                                    'duckduckgo.com/?q='][this.settings.webSearchOption];
            results.push(   {   type: APPTYPE.provider,
                                name: _('Search web for') + ' "' + text + '"',
                                description: '',
                                icon: new St.Icon({ gicon: new Gio.FileIcon({
                                            file: Gio.file_new_for_path(__meta.path + '/' + iconName)}),
                                            icon_size: this.getIconSize() }),
                                activate: () => {Util.spawnCommandLineAsync(
                                        '/usr/bin/xdg-open https://' + url + encodeURIComponent(text));}
                            } );
        }
        //---emoji search------
        if (pattern.length > 2 && this.settings.enableEmojiSearch) {
            EMOJI.forEach(emoji => {
                        const match1 = searchStr(pattern, emoji.name, true);
                        const match2 = searchStr(pattern, emoji.keywords, true);
                        match2.score *= 0.95; //slightly lower priority for keyword match
                        const bestMatchScore = Math.max(match1.score, match2.score);
                        if (bestMatchScore > SEARCH_THRESHOLD) {
                            results.push({
                                    name: emoji.name,
                                    description: _('Click to copy'),
                                    nameWithSearchMarkup: match1.result,
                                    //descriptionWithSearchMarkup: match2.result,
                                    type: APPTYPE.provider,
                                    icon: emoji.code,
                                    activate: () => { const clipboard = St.Clipboard.get_default();
                                        clipboard.set_text(St.ClipboardType.CLIPBOARD, emoji.code);}
                                        });
                        }});
        }
        //---search providers---
        const finish = () => {
            this.appsView.clear();
            this.populateAppsBox(results);
            let buttons = this.appsView.getActiveButtons();
            if (buttons.length > 0) {
                buttons[0].handleEnter();
            }
        };
        if (this.settings.enableSearchProviders && pattern.length > 2) {
            launch_all(pattern, (provider, providerResults) => {
                        for (let i = 0; i < providerResults.length; i++) {
                            if (!providerResults[i]) {
                                continue;
                            }
                            providerResults[i].type = APPTYPE.provider;
                            providerResults[i].name = providerResults[i].label.replace(/ : /g, ': ');
                            providerResults[i].activate = provider.on_result_selected;
                            providerResults[i].score = 0.1;
                            if (providerResults[i].icon) {
                                providerResults[i].icon.icon_size = this.getIconSize();
                            } else if (providerResults[i].icon_app){
                                providerResults[i].icon = providerResults[i].icon_app.create_icon_texture(
                                                                                            this.getIconSize());
                            } else if (providerResults[i].icon_filename){
                                providerResults[i].icon = new St.Icon({
                                      gicon: new Gio.FileIcon({
                                                file: Gio.file_new_for_path(providerResults[i].icon_filename)}),
                                                icon_size: this.getIconSize() });
                            }
                        }
                        if (!this.searchActive) {
                            return;
                        }
                        if (providerResults && providerResults.length > 0) {
                            results = results.concat(providerResults);
                        }
                        finish(); } );
        } else {
            finish();
        }
        //----------------------------------
        return false;
    }

    populateAppsBox(appList) {
        if (!appList) {
            return false;
        }
        const isListView = this.settings.applicationsViewMode === ApplicationsViewModeLIST;
        let column = 0;
        let rownum = 0;

        const addAppButton = (app, appIndex) => {
            let appButton;
            let refAppButton = this.allItems.findIndex(item => item && item.app === app);

            if (refAppButton > -1) {
                appButton = this.allItems[refAppButton];
                appButton.app = app;
                appButton.app.appIndex = appIndex;
            } else {
                app.appIndex = appIndex;
                appButton = new AppListGridButton(this, app);
                this.allItems.push(appButton);
            }

            if (isListView) {
                this.appsView.applicationsListBox.add_actor(appButton.actor);
            } else {
                const gridLayout = this.appsView.applicationsGridBox.layout_manager;
                if (!gridLayout) {
                    return false;
                }
                gridLayout.attach(appButton.actor, column, rownum, 1, 1);
                column++;

                if (column > this.settings.appsGridColumnCount - 1) {
                    column = 0;
                    rownum++;
                }
            }
        };
        this.appsView.applicationsListBox.hide();//hide while populating for performance.
        this.appsView.applicationsGridBox.hide();//
        let appCount = appList.length;
        if (appCount > 1000) {
            this.appsView.setAnswerText(_('Too many entries - showing first 1000 entries only'));
            appCount = 1000;
        }
        for (let i = 0; i < appCount; i++) {
            addAppButton(appList[i], i);
        }
        if (isListView) {
            this.appsView.applicationsListBox.show();
        } else {
            this.appsView.applicationsGridBox.show();
        }
    }
//--------------------
    display() {
		this.isListView = this.settings.applicationsViewMode === ApplicationsViewModeLIST;
        this.displayed = true;
        //==================bottomPane================
        const sidebarPlacement = this.settings.sidebarPlacement;
        this.sessionBox = new PowerGroupBox(this, sidebarPlacement);
        this.sessionBox.populate(this.apps.listFavorites());
        this.search = new Search(this);
        this.displaySignals.connect(this.search.searchEntryText, 'text-changed',
                                                        (...args) => this.onSearchTextChanged(...args));
        this.displaySignals.connect(this.search.searchEntryText, 'key-press-event',
                                                            (...args) => this.onMenuKeyPress(...args));
        //this.previousSearchPattern = '';
        this.bottomPane = new St.BoxLayout({ /*style: 'padding-top: 12px;'*/ });
        if (sidebarPlacement === PlacementTOP || sidebarPlacement === PlacementBOTTOM) {
            this.bottomPane.add(this.sessionBox.sessionScrollBox, { expand: false, x_fill: false, y_fill: false,
                                                  x_align: St.Align.START, y_align: St.Align.MIDDLE });
        }
        this.bottomPane.add(this.search.searchBox, { expand: true, x_fill: true, y_fill: false,
                                        x_align: St.Align.END, y_align: St.Align.MIDDLE, align_end: true });
        //=================middlePane======================
        this.contextMenu = new ContextMenu(this);
        this.appsView = new AppsView(this);
        this.categoriesView = new CategoriesView(this);
        this.categories.buildCategories();
        this.middlePane = new St.BoxLayout({ style_class: '' });
        if (sidebarPlacement === PlacementLEFT) {
            this.middlePane.add(this.sessionBox.sessionScrollBox, { expand: false, x_fill: false, y_fill: false,
                                                    x_align: St.Align.START, y_align: St.Align.MIDDLE });
        }
        this.middlePane.add(this.categoriesView.groupCategoriesWorkspacesScrollBox, { x_fill: false, y_fill: false,
                                                    x_align: St.Align.START, y_align: St.Align.START });
        this.middlePane.add(this.appsView.applicationsScrollBox, { x_fill: false, y_fill: false,
                                            x_align: St.Align.START, y_align: St.Align.START, expand: false });
        if (sidebarPlacement === PlacementRIGHT) {
            this.middlePane.add(this.sessionBox.sessionScrollBox, { expand: false, x_fill: false, y_fill: false,
                                                    x_align: St.Align.START, y_align: St.Align.MIDDLE });
        }
        //=============mainBox================
        //set style: 'spacing: 0px' so that extra space is not added to mainBox when contextMenuBox is
        //added. Only happens with themes that have set a spacing value on this node.
        this.mainBox = new St.BoxLayout({ style_class: 'menu-applications-outer-box', style: 'spacing: 0px',
                                        vertical: true, reactive: true,
                                        show_on_set_parent: false });
        this.mainBox.add_style_class_name('menu-applications-box'); //this is to support old themes
        // mainbox packs vertically
        if (sidebarPlacement === PlacementTOP) {
            this.mainBox.add(this.bottomPane);
        }
        this.mainBox.add_actor(this.middlePane);
        if (sidebarPlacement !== PlacementTOP) {
            this.mainBox.add(this.bottomPane);
        }

        //Add contextMenuBox to the stage by adding it to mainBox with it's height is set to 0. contextMenuBox
        //is then positioned at mouse coords and above siblings.
        this.mainBox.add(this.contextMenu.contextMenuBox, {expand: false, x_fill: false,
                                                    x_align: St.Align.START, y_align: St.Align.MIDDLE,});
        // add all to section
        const section = new PopupMenuSection();
        section.actor.add_actor(this.mainBox);
        this.menu.addMenuItem(section);// add section as menu item
        this.isNewInstance = false;
        //if a blank part of the menu was clicked on, close context menu
        this.menu.actor.set_reactive(true);
        this.displaySignals.connect(this.menu.actor, 'button-release-event',
                                                        (...args) => {this.clearEnteredActors();});
        //
        const Lpadding = this.categoriesView.categoriesBox.get_theme_node().get_length('padding-left');
        if (Lpadding > 20) {
            this.categoriesView.categoriesBox.style = 'padding-left: 20px;';
        }
        this.switchApplicationsView();
    }

    switchApplicationsView() {
        this.isListView = this.settings.applicationsViewMode === ApplicationsViewModeLIST;
        if (this.isListView) {
            this.appsView.applicationsGridBox.width = this.appsView.applicationsListBox.width;
            this.appsView.applicationsGridBox.hide();
            this.appsView.applicationsListBox.show();
        } else {
            this.appsView.applicationsGridBox.width = this.getGridWidth();
            this.appsView.applicationsListBox.hide();
            this.appsView.applicationsGridBox.show();
        }
        // switch activeContainer
        /*if (isListView) {
            // reset active container
            const vscroll = this.applicationsScrollBox.get_vscroll_bar();
            const newScrollValue = this.applicationsScrollBox.get_allocation_box().y1;
            vscroll.get_adjustment().set_value(newScrollValue);
        }*/
    }

    destroyDisplayed() {
        const destroyContainer = (container) => {
                        if (typeof this[container] == 'undefined') return false;
                        container = this[container];
                        if (!container || container.is_finalized()) return false;
                        container.get_children().forEach(child => child.destroy());
                        container.destroy();
                        return true; };
        this.displayed = false;
        this.displaySignals.disconnectAllSignals();
        this.categoryButtons.forEach(categoryButton => {categoryButton.destroy();
                                                        categoryButton = null;});
        this.categoryButtons = [];
        if (this.search) {
            this.search.destroy();
            this.search = null;
        }
        if (this.appsView) {
            this.appsView.destroy();
            this.appsView = null;
        }
        if (this.sessionBox) {
            this.sessionBox.destroy();
            this.sessionBox = null;
        }
        if (this.categoriesView) {
            this.categoriesView.destroy();
            this.categoriesView = null;
        }
        if (this.contextMenu) {
            this.contextMenu.destroy();
            this.contextMenu = null;
        }
        destroyContainer('middlePane');
        destroyContainer('bottomPane');
        destroyContainer('mainbox');
    }

    destroyAppButtons() {
        this.allItems.forEach(item => { if (item) item.destroy(); });
        this.allItems = [];
    }
}

class Categories {
    constructor(appThis) {
        this.appThis = appThis;
        this.appThis.categoryButtons = [];
    }

    buildCategories() {
        let buttons = [];
        let button = this.appThis.categoryButtons.find( button => button.id === 'all');
        if (!button) {
            button = new CategoryListButton(this.appThis, 'all', _('All Applications'), ['computer']);
        }
        buttons.push(button);
        const dirs = [];
        const iter = this.appThis.appSystem.get_tree().get_root_directory().iter();
        let nextType;
        while ((nextType = iter.next()) !== CMenu.TreeItemType.INVALID) {
            if (nextType === CMenu.TreeItemType.DIRECTORY) {
                dirs.push(iter.get_directory());
            }
        }
        dirs.sort(function(a, b) {
                        const prefCats = ['administration', 'preferences'];
                        const prefIdA = prefCats.indexOf(a.get_menu_id().toLowerCase());
                        const prefIdB = prefCats.indexOf(b.get_menu_id().toLowerCase());
                        if (prefIdA < 0 && prefIdB >= 0) return -1;
                        if (prefIdA >= 0 && prefIdB < 0) return 1;
                        const nameA = a.get_name().toLowerCase();
                        const nameB = b.get_name().toLowerCase();
                        return (nameA > nameB) ? 1 : ( (nameA < nameB) ? -1 : 0 );  });
        dirs.forEach(dir => {
            if (!dir.get_is_nodisplay()) {
                const dirId = dir.get_menu_id();
                if (this.appThis.apps.getAppsByCategory(dirId).length > 0) {
                    let button = this.appThis.categoryButtons.find(button => button.id === dirId);
                    if (!button) {
                        button = new CategoryListButton(this.appThis, dir, dirId);
                    }
                    buttons.push(button);
                }
            } });
        const home = GLib.get_home_dir();
        [   [this.appThis.settings.showPlaces, 'places', _('Places'), ['folder']],
            [this.appThis.recentEnabled, 'recents', _('Recent Files'), ['folder-recent', 'folder-documents-recent']],
            [this.appThis.settings.enableBookmarks, 'bookmarks', _('Bookmarks'), ['user-bookmarks']],
            [this.appThis.settings.showFavsCategory, 'favorites', _('Favorite Apps'), ['emblem-favorite', 'folder-favorites']],
            [this.appThis.settings.showHomeFolder, home,_('Home folder'),['user-home','folder']]
        ].forEach(param => {
                if (param[0]) {
                    let button = this.appThis.categoryButtons.find(button => button.id === param[1]);
                    if (!button) {
                        button = new CategoryListButton(this.appThis, param[1], param[2], param[3]);
                    }
                    buttons.push(button);
                } });

        //?undo
        if (this.appThis.settings.categories.length === 0) {
            this.appThis.settings.categories = buttons.map( button => button.id);
        }
        this.appThis.categoryButtons = [];
        // If a category option is enabled after the settings are set, or an application is installed
        // using a new category, we need to update the category order settings so it will render.
        if (buttons.length !== this.appThis.settings.categories.length - 1) {
            for (let i = 0; i < buttons.length; i++) {
                if (this.appThis.settings.categories.indexOf(buttons[i].id) === -1) {
                    this.appThis.settings.categories.push(buttons[i].id);
                }
            }
        }
        for (let i = 0; i < this.appThis.settings.categories.length; i++) {
            let button = buttons.find( (button) => button.id === this.appThis.settings.categories[i] );
            if (button) {
                button.index = i;
                this.appThis.categoryButtons.push(button);
            }
        }
        buttons = undefined;

        if (this.appThis.categoryButtons.length > 0) {
            this.appThis.categoriesView.categoriesBox.remove_all_children();
        }
        this.appThis.categoryButtons.forEach((button) =>
                                        this.appThis.categoriesView.categoriesBox.add_actor(button.actor));
    }
}

class CategoriesView {
    constructor(appThis) {
        this.appThis = appThis;

        this.categoriesBox = new St.BoxLayout({ style_class: 'menu-categories-box', vertical: true });
        this.groupCategoriesWorkspacesWrapper = new St.BoxLayout({/*style: 'max-width: 185px;',*/
                                                                                    vertical: true });
        this.groupCategoriesWorkspacesWrapper.add(this.categoriesBox, {
                                              x_fill: false, y_fill: true,
                                              x_align: St.Align.START, y_align: St.Align.END,
                                              y_expand: true, expand: false });
        // groupCategoriesWorkspacesScrollBox allows categories or workspaces to scroll vertically
        this.groupCategoriesWorkspacesScrollBox = new St.ScrollView({ x_fill: true, y_fill: false,
                                    y_align: St.Align.START, style_class: 'vfade menu-categories-scrollbox' });

        let vscrollCategories = this.groupCategoriesWorkspacesScrollBox.get_vscroll_bar();
        this.appThis.displaySignals.connect(vscrollCategories, 'scroll-start', () => { this.appThis.menu.passEvents = true; });
        this.appThis.displaySignals.connect(vscrollCategories, 'scroll-stop', () => { this.appThis.menu.passEvents = false; });
        this.groupCategoriesWorkspacesScrollBox.add_actor(this.groupCategoriesWorkspacesWrapper);
        this.groupCategoriesWorkspacesScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER);
        this.groupCategoriesWorkspacesScrollBox.set_auto_scrolling(this.appThis.settings.enableAutoScroll);
        this.groupCategoriesWorkspacesScrollBox.set_mouse_scrolling(true);
    }

    destroy() {
        if (!this.categoriesBox.is_finalized()) {
            this.categoriesBox.get_children().forEach(child => child.destroy());
        }
        this.categoriesBox.destroy();
        this.groupCategoriesWorkspacesWrapper.destroy();
        this.groupCategoriesWorkspacesScrollBox.destroy();
    }
}

class AppsView {
    constructor(appThis) {
        this.appThis = appThis;

        this.applicationsListBox = new St.BoxLayout({ /*style: 'min-width: 300px;',*/ vertical: true });
        this.applicationsGridBox = new Clutter.Actor({ layout_manager: new Clutter.GridLayout(),
                                                       reactive: true, width: this.appThis.getGridWidth() });
        this.answerText = new St.Label({ style_class: 'menu-selected-app-title',
                                         style: 'padding-top: 14px; min-width: 240px; text-align; center;',
                                         text: '', show_on_set_parent: false });
        this.applicationsBoxWrapper = new St.BoxLayout({  style_class: 'menu-applications-inner-box',
                                                    /*style: 'min-width: 275px',*/ vertical: true, reactive: true });

        this.applicationsBoxWrapper.add(this.answerText, {  x_fill: false, y_fill: false,
                                                            x_align: St.Align.MIDDLE, y_align: St.Align.START });
        this.applicationsBoxWrapper.add(this.applicationsGridBox, { x_fill: false, y_fill: false,
                                                            x_align: St.Align.START, y_align: St.Align.START });
        this.applicationsBoxWrapper.add(this.applicationsListBox, { x_fill: true, y_fill: false,
                                                            x_align: St.Align.START, y_align: St.Align.START });
        this.applicationsScrollBox = new St.ScrollView({  x_fill: true, y_fill: false,
                            y_align: St.Align.START, style_class: 'vfade menu-applications-scrollbox' });
        const vscrollApplications = this.applicationsScrollBox.get_vscroll_bar();
        this.appThis.displaySignals.connect(vscrollApplications, 'scroll-start',
                                                                () => { this.appThis.menu.passEvents = true; });
        this.appThis.displaySignals.connect(vscrollApplications, 'scroll-stop',
                                                                () => { this.appThis.menu.passEvents = false; });
        this.applicationsScrollBox.add_actor(this.applicationsBoxWrapper);
        this.applicationsScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.applicationsScrollBox.set_auto_scrolling(this.appThis.settings.enableAutoScroll);
        this.applicationsScrollBox.set_mouse_scrolling(true);

    }

    getActiveButtons() {
        const buttons = [];
        this.getActiveContainer().get_children().forEach(child =>
            buttons.push( this.appThis.allItems.find(button => button && button.actor === child) ));
        return buttons;
    }

    clear() {
        this.setAnswerText(null);
        this.clearEnteredActors();
        if (this.applicationsListBox) {
            this.applicationsListBox.remove_all_children();
        }

        if (this.applicationsGridBox && !this.applicationsGridBox.is_finalized()) {
            this.applicationsGridBox.remove_all_children();
        }
    }

    clearEnteredActors() {
        const buttons = this.getActiveButtons();
        for (let i = 0; i<buttons.length; i++) {
            if (buttons[i].actor.has_style_class_name('menu-application-button-selected') ||
                                                                            buttons[i].entered != null ) {
                buttons[i].handleLeave();
                buttons[i].entered = null;
            }
        }
    }

    setAnswerText(text) {
        if (text) {
            this.answerText.set_text(text);
            this.answerText.show();
        } else {
            this.answerText.hide();
        }
    }

    getActiveContainer() {
        return this.appThis.settings.applicationsViewMode === ApplicationsViewModeLIST ?
                                                this.applicationsListBox : this.applicationsGridBox;
    }

    destroy() {
        this.answerText.destroy();
        this.applicationsListBox.destroy();
        this.applicationsGridBox.destroy();
        this.applicationsBoxWrapper.destroy();
        this.applicationsScrollBox.destroy();
    }
}

class Apps {
    constructor(appThis) {
        this.appThis = appThis;
        this.recentManager = getDocManager();
        this.appsByCategory = {};
        this.knownApps = [];
        this.appsNeedRefresh = true;
    }

    installedChanged() {
        this.appsNeedRefresh = true;
    }

    initAppCategories() {
        if (!this.appsNeedRefresh) return;

        const dirs = [];
        const iter = this.appThis.appSystem.get_tree().get_root_directory().iter();
        let nextType;
        while ((nextType = iter.next()) !== CMenu.TreeItemType.INVALID) {
            if (nextType === CMenu.TreeItemType.DIRECTORY) {
                dirs.push(iter.get_directory());
            }
        }

        for (let z = 0; z < dirs.length; z++) {
            const dir = dirs[z];
            if (!dir.get_is_nodisplay()) {
                const dirId = dir.get_menu_id();
                this.appsByCategory[dirId] = [];
                this.loadAppCategories(dir, null, dirId);
                this.appsByCategory[dirId].sort( (a, b) => {
                                            if (!a.name || !b.name) return -1;
                                            return (a.name.toLowerCase() > b.name.toLowerCase()) ?
                                                    1 : (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : 0;  });
            }
        }
        let keys = Object.keys(this.appsByCategory);
        let all = [];
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] !== 'all') {
                all = all.concat(this.appsByCategory[keys[i]]);
            }
        }

        let uniqueSet = new Set();
        this.appsByCategory.all = [];
        for (let i = 0; i < all.length; i++) {
            if (uniqueSet.has(all[i]) === false) {
                this.appsByCategory.all.push(all[i]);
                uniqueSet.add(all[i]);
            }
        }

        this.appsByCategory.all.sort( (a, b) => {
                                    if (!a.name || !b.name) return -1;
                                    return (a.name.toLowerCase() > b.name.toLowerCase()) ?
                                            1 : (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : 0;  });

        this.appsNeedRefresh = false;
    }

    loadAppCategories(dir, rootDir, dirId) {
        const iter = dir.iter();
        let nextType;
        while ((nextType = iter.next()) !== CMenu.TreeItemType.INVALID) {
            if (nextType === CMenu.TreeItemType.ENTRY) {
                const entry = iter.get_entry();
                if (!entry.get_app_info().get_nodisplay()) {
                    const id = entry.get_desktop_file_id();
                    const app = this.appThis.appSystem.lookup_app(id);
                    let found = false;
                    if (rootDir && typeof rootDir.get_menu_id === 'function') {
                        const rootDirId = rootDir.get_menu_id();
                        if (rootDirId) {
                            this.appsByCategory[rootDirId].push(app);
                            found = true;
                        }
                    } else {
                        if (dirId) {
                            this.appsByCategory[dirId].push(app);
                            found = true;
                        }
                    }
                    if (found) {
                        let obj = app.hasOwnProperty('item') ? app.item : app;
                        if (!obj.hasOwnProperty('name')) {
                            obj.name = obj.get_name();
                        }
                        if (!obj.hasOwnProperty('description')) {
                            obj.description = obj.get_description();
                        }
                        if (!app.description || app.description == '') {
                            app.description = _('No description available');
                        }
                        app.type = APPTYPE.application;
                    }
                    if (this.knownApps.indexOf(id) < 0) {//unknown app
                        if (!this.appThis.isNewInstance) {
                            app.newAppShouldHighlight = true;
                        }
                        this.knownApps.push(id);
                    }
                }
            } else if (nextType === CMenu.TreeItemType.DIRECTORY) {
                if (rootDir) {
                    this.loadAppCategories(iter.get_directory(), rootDir, null);
                } else {
                    this.loadAppCategories(iter.get_directory(), dir, dirId);
                }
            }
        }
    }

    getAppsByCategory(dirId) {
        if (this.appsNeedRefresh) {
            this.initAppCategories();
        }
        return this.appsByCategory[dirId];
    }

    listApplications(categoryMenuId, pattern) {
        let res = this.getAppsByCategory(categoryMenuId);

        if (pattern) {
            let _res = [];
            for (let i = 0, len = res.length; i < len; i++) {
                const keywords = res[i].get_keywords() || '';
                const id = res[i].get_id().replace(/\.desktop$/, '');
                const match1 = searchStr(pattern, res[i].name);
                const match2 = searchStr(pattern, res[i].description);
                match2.score *= 0.95; //slightly lower priority for description match
                const match3 = searchStr(pattern, keywords);
                match3.score *= 0.6; //low priority for keyword match
                const match4 = searchStr(pattern, id);
                match4.score *= 0.6; //low priority for id match
                const bestMatchScore = Math.max(match1.score, match2.score, match3.score, match4.score);
                if (bestMatchScore > SEARCH_THRESHOLD) {
                    res[i].score = bestMatchScore;
                    res[i].nameWithSearchMarkup = match1.result;
                    res[i].descriptionWithSearchMarkup = match2.result;
                    res[i].keywordsWithSearchMarkup = match3.result;
                    res[i].idWithSearchMarkup = match4.result;
                    _res.push(res[i]);
                }
            }
            res = _res;
            _res = null;
        }
        return res;
    }

    listFavorites() {
        let res = this.appThis.favorites;

        for (let i = 0, len = res.length; i < len; i++) {

            let obj = res[i].hasOwnProperty('item') ? res[i].item : res[i];
            if (!obj.hasOwnProperty('name')) {
                obj.name = obj.get_name();
            }
            if (!obj.hasOwnProperty('description')) {
                obj.description = obj.get_description();
            }
            res[i].type = APPTYPE.application;
        }
        return res;
    }

    listRecent(pattern) {
        //_infosByTimestamp seems to contain new objects even if the files are the same so store and
        // reuse objects if they have the same name and uriDecoded.
        if (!this.knownRecents) this.knownRecents = [];
        const {_infosByTimestamp} = this.recentManager;
        let res = [];
        for (let i = 0, len = _infosByTimestamp.length; i < len; i++) {
            const recentInfo = _infosByTimestamp[i];
            /*if (!GLib.file_test(Gio.File.new_for_uri(recentInfo.uri).get_path(), GLib.FileTest.EXISTS)) {
                continue;
            }*/
            let found = false;
            for (let r = 0; r < this.knownRecents.length; r++) {
                if (recentInfo.name === this.knownRecents[r].name &&
                                            recentInfo.uriDecoded === this.knownRecents[r].description) {
                    res.push(this.knownRecents[r]);
                    found = true;
                    break;
                }
            }
            if (!found) {
                const newRecent = { name: recentInfo.name,
                                    icon: recentInfo.gicon,
                                    uri: recentInfo.uri,
                                    mimeType: recentInfo.mimeType,
                                    description: Gio.File.new_for_uri(recentInfo.uri).get_path(),
                                    type: APPTYPE.file };
                res.push(newRecent);
                this.knownRecents.push(newRecent);
            }
        }
        // create "Clear list" icon
        if (res.length > 0  && !pattern) {
            if (!this.clearlistItem) {
                this.clearlistItem = {  name: _('Clear List'),
                                        clearList: true,
                                        description: '',
                                        type: APPTYPE.clearlist };
            }
            res.push(this.clearlistItem);
        }

        if (pattern) {
            const _res = [];
            for (let i = 0, len = res.length; i < len; i++) {
                const recentItem = res[i];
                const match = searchStr(pattern, recentItem.name);
                if (recentItem.name && match.score > SEARCH_THRESHOLD) {
                    recentItem.score = match.score;
                    recentItem.nameWithSearchMarkup = match.result;
                    _res.push(recentItem);
                }
            }
            res = _res;
        }
        return res;
    }

    listPlaces(pattern) {
        const places = Main.placesManager.getAllPlaces();
        let res = [];
        for (let i = 0; i < places.length; i++) {
            let selectedAppId = places[i].idDecoded.substr(places[i].idDecoded.indexOf(':') + 1);
            const fileIndex = selectedAppId.indexOf('file:///');
            if (fileIndex !== -1) {
                selectedAppId = selectedAppId.substr(fileIndex + 7);
            }
            if (selectedAppId === "home" || selectedAppId === "desktop" || selectedAppId === "connect") {
                selectedAppId = places[i].name;
            }
            let icon = places[i].iconFactory(this.appThis.getIconSize());
            if (!icon) {
                icon = new St.Icon({ icon_name: 'folder', icon_size: this.appThis.getIconSize()});
            }
            places[i].icon = icon;
            places[i].type = APPTYPE.place;
            places[i].description = selectedAppId;
            res.push(places[i]);
        }

        if (pattern) {
            const _res = [];
            for (let i = 0, len = res.length; i < len; i++) {
                const match = searchStr(pattern, res[i].name);
                if (match.score > SEARCH_THRESHOLD) {
                    places[i].nameWithSearchMarkup = match.result;
                    places[i].score = match.score;
                    _res.push(places[i]);
                }
            }
            res = _res;
        }
        return res;
    }

    listWebBookmarks(pattern) {
        let res = this.appThis.bookmarksManager.state;

        if (pattern) {
            const _res = [];
            for (let i = 0, len = res.length; i < len; i++ ) {
                const bookmark = res[i];
                if (bookmark.name) {
                    let match = searchStr(pattern, bookmark.name);
                    if (match.score > SEARCH_THRESHOLD) {
                        bookmark.score = match.score;
                        bookmark.nameWithSearchMarkup = match.result;
                        _res.push(bookmark);
                    }
                }
            }
            res = _res;
        }
        return res;
    }

    listFolder(folder) {
        const res = [];
        const dir = Gio.file_new_for_path(folder);
        let enumerator;
        tryFn(() => {   enumerator = dir.enumerate_children("standard::*", 0, null); }, (e) => {
                            this.appThis.appsView.setAnswerText(e.message); });
        let next;
        if (enumerator) {
            next = enumerator.next_file(null);
        }
        while (next) {
            const filename = next.get_name();
            if (!filename.startsWith('.')) {
                const file = Gio.file_new_for_path(folder + (folder === '/' ? '' : '/') + filename);
                const newRecent = { name: next.get_name(),
                                    icon: next.get_icon(),
                                    uri: file.get_uri(),
                                    mimeType: next.get_content_type(),
                                    directory: file.query_file_type(0, null) === 2,
                                    description: '',//file.get_path(),
                                    type: APPTYPE.file };
                res.push(newRecent);
            }
            next = enumerator.next_file(null);
        }
        res.sort(function(a, b) {   if (!a.directory && b.directory) return 1;
                                    else if (a.directory && !b.directory) return -1;
                                    else {
                                        const nameA = a.name.toLowerCase();
                                        const nameB = b.name.toLowerCase();
                                        return (nameA > nameB) ? 1 : ( (nameA < nameB) ? -1 : 0 );
                                    } });
        const parent = dir.get_parent();
        if (parent) {
            const backButton = {  name: 'Back',
                            icon: null,
                            uri: parent.get_uri(),
                            mimeType: 'inode/directory',
                            directory: true,
                            description: parent.get_path(),
                            type: APPTYPE.file };
            return [backButton].concat(res);
        } else {
            return res;
        }
    }

    destroy() {

    }
}

class Search {
    constructor(appThis) {
        this.searchInactiveIcon = new St.Icon({ style_class: 'menu-search-entry-icon', icon_name: 'edit-find' });
        this.searchActiveIcon = new St.Icon({ style_class: 'menu-search-entry-icon', icon_name: 'edit-clear' });
        this.searchEntry = new St.Entry({ name: 'menu-search-entry', //hint_text: HINT_TEXT,
                                          track_hover: true, can_focus: true, });
        this.searchEntryText = this.searchEntry.clutter_text;

        this.searchEntry.set_primary_icon(this.searchInactiveIcon);
        this.searchBox = new St.BoxLayout({ style_class: 'menu-search-box',
                                            style: /*'padding-right: 7px;*/ 'min-width: 160px;' });
        this.searchBox.add(this.searchEntry, {  expand: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });
    }

    showSecondaryIcon(show) {
        if (show) {
            this.searchEntry.set_secondary_icon(this.searchActiveIcon);
        } else {
            this.searchEntry.set_secondary_icon(null);
        }
    }

    destroy() {
        this.searchInactiveIcon.destroy();
        this.searchActiveIcon.destroy();
        this.searchEntry.destroy();
        this.searchBox.destroy();
    }

}

class PowerGroupBox {
    constructor (appThis, sidebarPlacement) {
        this.appThis = appThis;
        const style_class = this.appThis.settings.useBoxStyle ? 'menu-favorites-box' : '';
        this.box = new St.BoxLayout({ style_class: style_class,
                        vertical: (sidebarPlacement === PlacementLEFT || sidebarPlacement === PlacementRIGHT) });
        this.sessionScrollBox = new St.ScrollView({  x_fill: true, y_fill: false, x_align: St.Align.MIDDLE,
                            y_align: St.Align.MIDDLE, style_class: 'vfade menu-favorites-scrollbox' });

        const vscroll_bar = this.sessionScrollBox.get_vscroll_bar();
        this.appThis.displaySignals.connect(vscroll_bar, 'scroll-start',
                                                                () => { this.appThis.menu.passEvents = true; });
        this.appThis.displaySignals.connect(vscroll_bar, 'scroll-stop',
                                                                () => { this.appThis.menu.passEvents = false; });
        this.sessionScrollBox.add_actor(this.box);
        this.sessionScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER);
        this.sessionScrollBox.set_auto_scrolling(this.appThis.settings.enableAutoScroll);
        this.sessionScrollBox.set_mouse_scrolling(true);
    }

    populate (favs) {
        this.destroyChildren();
        const reverseOrder = this.appThis.settings.sidebarPlacement === PlacementTOP ||
                                                this.appThis.settings.sidebarPlacement === PlacementBOTTOM;
        //add favorites
        this.items = [];
        if (this.appThis.settings.addFavorites) {
            for (let i=0; i<favs.length; i++) {
                this.items.push(new GroupButton( this.appThis,
                                favs[i].create_icon_texture(this.appThis.settings.sessionIconSize), favs[i],
                                    favs[i].name, favs[i].description, null));
            }
        }
        if (reverseOrder) {
            this.items.reverse(); //change order of favs if buttons placement is top or bottom
        }
        //add session buttons
        const iconObj = { icon_size: this.appThis.settings.sessionIconSize,
                          icon_type: this.appThis.settings.sessionIconSize <= 24 ? St.IconType.SYMBOLIC :
                                                                                    St.IconType.FULLCOLOR };
        iconObj.icon_name = 'system-lock-screen';
        this.items.push(new GroupButton( this.appThis, new St.Icon(iconObj), null, _('Lock Screen'),
                    _('Lock the screen'), () => {
                        let screensaver_settings = new Gio.Settings({
                                                    schema_id: 'org.cinnamon.desktop.screensaver' });
                        let screensaver_dialog = Gio.file_new_for_path('/usr/bin/cinnamon-screensaver-command');
                        if (screensaver_dialog.query_exists(null)) {
                            if (screensaver_settings.get_boolean('ask-for-away-message')) {
                                Util.spawnCommandLine('cinnamon-screensaver-lock-dialog');
                            } else {
                                Util.spawnCommandLine('cinnamon-screensaver-command --lock');//
                            }
                        } else {
                            this.screenSaverProxy.LockRemote('');
                        }
                        this.appThis.closeMenu(); }));
        iconObj.icon_name = 'system-log-out';
        this.items.push(new GroupButton( this.appThis, new St.Icon(iconObj), null, _('Logout'),
                                    _('Leave the session'), () => { Util.spawnCommandLine('cinnamon-session-quit');
                                                                        this.appThis.closeMenu(); } ));
        iconObj.icon_name = 'system-shutdown';
        this.items.push(new GroupButton( this.appThis, new St.Icon(iconObj), null, _('Quit'),
                    _('Shutdown the computer'), () => { Util.spawnCommandLine('cinnamon-session-quit --power-off');
                                                                this.appThis.closeMenu(); } ));
        //change order of all items depending on buttons placement
        if (reverseOrder) {
            this.items.reverse();
        }
        //populate box with items[]
        for (let i = 0; i < this.items.length; i++) {
            if ((!reverseOrder && i == this.items.length - 3 && this.items.length > 3) ||
                        (reverseOrder && i == 3 && this.items.length > 3)){// add seperator dot to box
                const dot = new St.Widget({ style: 'width: 4px; height: 4px; background-color: ' +
                        this.appThis.getThemeForegroundColor() + '; margin: 7px; border: 3px; border-radius: 10px;',
                                layout_manager: new Clutter.BinLayout(), x_expand: false, y_expand: false, });
                this.box.add(dot, { x_fill: false, y_fill: false,
                                x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
            }
            this.box.add(this.items[i].actor, { x_fill: false, y_fill: false,
                                                        x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
        }
        return;
    }

    getButtons() {
        return this.items;
    }

    clearEnteredActors() {
        const foundItem = this.items.findIndex( (button) => button.entered != null );
        if (foundItem > -1 && this.items[foundItem]) {
            this.items[foundItem].handleLeave();
        }
    }

    destroyChildren() {
        if (!this.box.is_finalized()) {
            let children = this.box.get_children();
            for (let i = 0, len = children.length; i < len; i++) {
                children[i].destroy();
            }
            this.items = null;
        }
    }

    destroy() {
        this.destroyChildren();
        this.box.destroy();
        this.sessionScrollBox.destroy();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CinnamenuApplet(metadata, orientation, panel_height, instance_id);
}
