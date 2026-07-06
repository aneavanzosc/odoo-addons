/* @odoo-module */

import {Component, onMounted, onWillStart, useRef, useState} from "@odoo/owl";
import {SelectCreateDialog} from "@web/views/view_dialogs/select_create_dialog";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {useService} from "@web/core/utils/hooks";

class ReconciliationLegacyView extends Component {
  static template = "account_reconcile_legacy.ReconciliationLegacyView";

  setup() {
    this.orm = useService("orm");
    this.action = useService("action");
    this.dialog = useService("dialog");
    this.notification = useService("notification");
    this.root = useRef("root");
    this.state = useState({
      groups: [],
      lines: [],
      selectedGroupId: false,
      selectedLineIds: [],
      selectedPartnerId: false,
      selectedPartnerName: "",
      isMatchPanelOpen: false,
      isLoading: true,
      manualForm: this.emptyManualForm(),
      manualFormLineId: false,
      options: {
        accounts: [],
        analyticAccounts: [],
        journals: [],
        taxes: [],
      },
    });
    onWillStart(async () => {
      await this.loadOptions();
      await this.loadGroups();
    });
    onMounted(() => {
      this.root.el?.focus();
    });
  }

  get selectedGroup() {
    return this.state.groups.find((group) => group.id === this.state.selectedGroupId);
  }

  get selectedPartnerId() {
    return this.state.selectedPartnerId || this.selectedGroup?.partner_id?.[0] || "";
  }

  get selectedPartnerName() {
    return this.state.selectedPartnerName || this.selectedGroup?.partner_id?.[1] || "";
  }

  get partnerSelectorLabel() {
    return this.selectedPartnerName || _t("Sin nombre");
  }

  get isBankReconciliation() {
    return this.reconcileKind === "bank";
  }

  get progressLabel() {
    const total = this.state.groups.length;
    const current =
      total && this.state.selectedGroupId
        ? this.state.groups.findIndex(
            (group) => group.id === this.state.selectedGroupId
          ) + 1
        : 0;
    return `${current} / ${total}`;
  }

  get canReconcile() {
    return this.state.selectedLineIds.length >= 2;
  }

  get selectedLines() {
    return this.state.lines.filter((line) => this.isLineSelected(line.id));
  }

  get selectedBalance() {
    return this.selectedLines.reduce(
      (total, line) => total + Number(line.amountRaw || 0),
      0
    );
  }

  get differenceAmount() {
    return -this.selectedBalance;
  }

  get differenceCurrency() {
    return (
      this.selectedLines[0]?.currencyName || this.selectedGroup?.currencyName || "EUR"
    );
  }

  get differenceHintLabel() {
    if (!this.selectedLines.length) {
      return this.selectedGroup?.amountLabel || "";
    }
    return this.formatCurrency(
      Math.abs(this.differenceAmount),
      this.differenceCurrency
    );
  }

  get writeoffDifferenceLabel() {
    if (!this.selectedLines.length) {
      return "";
    }
    return this.formatCurrency(this.differenceAmount, this.differenceCurrency);
  }

  get candidateLines() {
    if (this.isBankReconciliation) {
      return this.state.lines;
    }
    return this.state.lines.filter((line) => !this.isLineSelected(line.id));
  }

  async loadGroups() {
    this.state.isLoading = true;
    await this.loadManualGroups();
    this.state.isLoading = false;
  }

  async loadOptions() {
    const [accounts, journals, taxes, analyticAccounts] = await Promise.all([
      this.loadOptionRecords(
        "account.account",
        [["deprecated", "=", false]],
        ["display_name"],
        {limit: 120, order: "code"}
      ),
      this.loadOptionRecords("account.journal", [], ["display_name"], {
        limit: 80,
        order: "name",
      }),
      this.loadOptionRecords("account.tax", [["active", "=", true]], ["display_name"], {
        limit: 80,
        order: "name",
      }),
      this.loadOptionRecords("account.analytic.account", [], ["display_name"], {
        limit: 80,
        order: "name",
      }),
    ]);
    this.state.options = {
      accounts,
      analyticAccounts,
      journals,
      taxes,
    };
  }

  async loadOptionRecords(model, domain, fields, kwargs) {
    try {
      return await this.orm.searchRead(model, domain, fields, kwargs);
    } catch {
      return [];
    }
  }

  async loadManualGroups() {
    const groups = await this.orm.call(
      "account.reconcile.legacy",
      "get_manual_groups",
      []
    );
    this.state.groups = groups.map((group) => ({
      ...group,
      displayName:
        group.partner_id?.[1] || group.account_id?.[1] || _t("Pending reconciliation"),
    }));
    this.state.selectedGroupId = this.state.groups[0]?.id || false;
    this.setPartnerFromSelectedGroup();
    if (this.state.selectedGroupId) {
      await this.loadLines(this.state.selectedGroupId);
    } else {
      this.state.lines = [];
      this.state.selectedLineIds = [];
    }
    this.state.isMatchPanelOpen = false;
  }

  async selectGroup(groupId) {
    if (this.state.selectedGroupId === groupId) {
      return;
    }
    this.state.selectedGroupId = groupId;
    this.state.isMatchPanelOpen = false;
    this.setPartnerFromSelectedGroup();
    await this.loadLines(groupId);
  }

  async toggleGroup(groupId, ev) {
    ev.stopPropagation();
    if (this.state.selectedGroupId === groupId) {
      this.state.selectedGroupId = false;
      this.state.lines = [];
      this.state.selectedLineIds = [];
      this.state.isMatchPanelOpen = false;
      this.state.selectedPartnerId = false;
      this.state.selectedPartnerName = "";
      this.syncManualForm();
      return;
    }
    await this.selectGroup(groupId);
  }

  toggleMatchPanel(ev) {
    ev.stopPropagation();
    this.state.isMatchPanelOpen = !this.state.isMatchPanelOpen;
  }

  openSelectedGroupRecord(ev) {
    ev.stopPropagation();
    const group = this.selectedGroup;
    if (!group) {
      return;
    }
    const partnerId = group.partner_id?.[0];
    const accountId = group.account_id?.[0];
    if (partnerId) {
      this.openFormView("res.partner", partnerId);
    } else if (accountId) {
      this.openFormView("account.account", accountId);
    }
  }

  openFormView(resModel, resId) {
    this.action.doAction({
      type: "ir.actions.act_window",
      res_model: resModel,
      res_id: resId,
      views: [[false, "form"]],
      target: "current",
    });
  }

  setPartnerFromSelectedGroup() {
    const partner = this.selectedGroup?.partner_id || [];
    this.state.selectedPartnerId = partner[0] || false;
    this.state.selectedPartnerName = partner[1] || "";
  }

  openPartnerSelector(ev) {
    ev.stopPropagation();
    this.dialog.add(SelectCreateDialog, {
      resModel: "res.partner",
      title: _t("Buscar: partner_id"),
      multiSelect: false,
      onSelected: async (resIds) => {
        await this.setSelectedPartner(resIds[0]);
      },
      onUnselect: async () => {
        await this.setSelectedPartner(false);
      },
    });
  }

  async setSelectedPartner(partnerId) {
    const lineId = this.selectedGroup?.mainLineId;
    if (!lineId) {
      this.notification.add(_t("No journal item is selected."), {
        type: "warning",
      });
      return;
    }
    let partnerName = "";
    if (partnerId) {
      const [partner] = await this.orm.read(
        "res.partner",
        [partnerId],
        ["display_name"]
      );
      partnerName = partner?.display_name || "";
    }
    await this.orm.write("account.move.line", [lineId], {
      partner_id: partnerId || false,
    });
    const partnerValue = partnerId ? [partnerId, partnerName] : false;
    this.state.groups = this.state.groups.map((group) =>
      group.id === this.state.selectedGroupId
        ? {...group, partner_id: partnerValue}
        : group
    );
    this.state.lines = this.state.lines.map((line) =>
      line.id === lineId ? {...line, partner_id: partnerValue} : line
    );
    this.state.selectedPartnerId = partnerId || false;
    this.state.selectedPartnerName = partnerName;
    this.state.manualForm = {
      ...this.state.manualForm,
      partner: partnerName,
      partnerId: partnerId || false,
    };
  }

  onKeydown(ev) {
    if (
      !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(ev.key)
    ) {
      return;
    }
    if (["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) {
      return;
    }
    const amountByKey = {
      ArrowDown: 60,
      ArrowUp: -60,
      PageDown: this.root.el.clientHeight * 0.85,
      PageUp: -this.root.el.clientHeight * 0.85,
    };
    ev.preventDefault();
    if (ev.key === "Home") {
      this.root.el.scrollTo({top: 0, behavior: "smooth"});
    } else if (ev.key === "End") {
      this.root.el.scrollTo({top: this.root.el.scrollHeight, behavior: "smooth"});
    } else {
      this.root.el.scrollBy({top: amountByKey[ev.key], behavior: "smooth"});
    }
  }

  async loadLines(groupId) {
    const group = this.state.groups.find((item) => item.id === groupId);
    if (!group) {
      this.state.lines = [];
      this.state.selectedLineIds = [];
      this.syncManualForm();
      return;
    }
    const lines = await this.orm.call("account.reconcile.legacy", "get_manual_lines", [
      group,
    ]);
    this.state.lines = lines;
    this.state.selectedLineIds = [];
    this.syncManualForm();
  }

  toggleLine(lineId) {
    if (this.state.selectedLineIds.includes(lineId)) {
      this.state.selectedLineIds = this.state.selectedLineIds.filter(
        (id) => id !== lineId
      );
    } else {
      this.state.selectedLineIds = [...this.state.selectedLineIds, lineId];
    }
    this.syncManualForm(lineId);
  }

  isLineSelected(lineId) {
    return this.state.selectedLineIds.includes(lineId);
  }

  formatCurrency(amount, currency) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
    }).format(amount || 0);
  }

  emptyManualForm() {
    return {
      account: "",
      accountId: false,
      analyticAccount: "",
      analyticAccountId: false,
      amount: "",
      journal: "",
      journalId: false,
      label: "",
      partner: "",
      partnerId: false,
      reference: false,
      tax: "",
      taxId: false,
      writeoffDate: this.formatDateForInput(new Date()),
    };
  }

  getManualFormLine(preferredLineId = false) {
    const selectedLines = this.selectedLines;
    return (
      selectedLines.find((line) => line.id === preferredLineId) || selectedLines[0]
    );
  }

  getLinePartner(line) {
    const partner = this.state.selectedPartnerId
      ? [this.state.selectedPartnerId, this.state.selectedPartnerName]
      : line.partner_id || this.selectedGroup?.partner_id || [];
    return {
      partner: partner[1] || "",
      partnerId: partner[0] || false,
    };
  }

  getLineJournal() {
    const journal = this.selectedGroup?.journal_id || [];
    return {
      journal: journal[1] || "",
      journalId: journal[0] || false,
    };
  }

  getManualFormFromLine(line) {
    return {
      account: line.account_id?.[1] || "",
      accountId: line.account_id?.[0] || false,
      analyticAccount: "",
      analyticAccountId: false,
      amount: this.writeoffDifferenceLabel || line.amountLabel || "",
      label: line.label || "",
      reference: line.reference || false,
      tax: "",
      taxId: false,
      writeoffDate: line.date || this.formatDateForInput(new Date()),
      ...this.getLineJournal(),
      ...this.getLinePartner(line),
    };
  }

  syncManualForm(preferredLineId = false) {
    const line = this.getManualFormLine(preferredLineId);
    this.state.manualFormLineId = line?.id || false;
    this.state.manualForm = line
      ? this.getManualFormFromLine(line)
      : this.emptyManualForm();
  }

  updateManualForm(fieldName, ev) {
    const value = ev.target.value;
    this.state.manualForm = {
      ...this.state.manualForm,
      [fieldName]: value,
    };
    if (!this.state.manualFormLineId) {
      return;
    }
    this.state.lines = this.state.lines.map((line) => {
      if (line.id !== this.state.manualFormLineId) {
        return line;
      }
      if (fieldName === "account") {
        return {
          ...line,
          account_id: [line.account_id?.[0] || false, value],
        };
      }
      if (fieldName === "amount") {
        return {
          ...line,
          amountLabel: value,
        };
      }
      if (fieldName === "label") {
        return {
          ...line,
          label: value,
        };
      }
      if (fieldName === "partner") {
        return {
          ...line,
          partner_id: [line.partner_id?.[0] || false, value],
        };
      }
      return line;
    });
  }

  updateManualSelection(fieldName, optionsKey, ev) {
    const id = Number(ev.target.value) || false;
    const option = this.state.options[optionsKey].find((item) => item.id === id);
    this.state.manualForm = {
      ...this.state.manualForm,
      [fieldName]: option?.display_name || "",
      [`${fieldName}Id`]: id,
    };
    if (fieldName === "account") {
      this.updateSelectedLineFromForm("account_id", [id, option?.display_name || ""]);
    }
  }

  updateSelectedLineFromForm(fieldName, value) {
    if (!this.state.manualFormLineId) {
      return;
    }
    this.state.lines = this.state.lines.map((line) =>
      line.id === this.state.manualFormLineId ? {...line, [fieldName]: value} : line
    );
  }

  saveManualLineAndNew() {
    if (
      !this.state.manualForm.account &&
      !this.state.manualForm.label &&
      !this.state.manualForm.amount
    ) {
      return;
    }
    const lineId = `manual-${Date.now()}`;
    const line = {
      id: lineId,
      accountId: this.state.manualForm.accountId,
      account_id: [this.state.manualForm.accountId, this.state.manualForm.account],
      amountLabel: this.state.manualForm.amount,
      date: this.state.manualForm.writeoffDate,
      isManual: true,
      label: this.state.manualForm.label,
      partnerId: this.state.manualForm.partnerId,
      partner_id: [this.state.manualForm.partnerId, this.state.manualForm.partner],
      reference: false,
    };
    this.state.lines = [...this.state.lines, line];
    this.state.selectedLineIds = [...this.state.selectedLineIds, lineId];
    this.state.manualForm = this.emptyManualForm();
    this.state.manualFormLineId = false;
  }

  formatDateForInput(date) {
    return date.toISOString().slice(0, 10);
  }

  async reconcileSelectedLines() {
    if (!this.canReconcile) {
      this.notification.add(_t("Select at least two journal items."), {
        type: "warning",
      });
      return;
    }
    try {
      await this.orm.call("account.reconcile.legacy", "reconcile_manual_lines", [
        this.state.selectedLineIds,
        this.state.manualForm,
      ]);
      this.notification.add(_t("Reconciliation validated."), {
        type: "success",
      });
      await this.loadGroups();
    } catch (error) {
      this.notification.add(
        error.message || _t("The reconciliation could not be validated."),
        {
          type: "danger",
        }
      );
    }
  }
}

class ManualReconciliationLegacyView extends ReconciliationLegacyView {
  setup() {
    this.reconcileKind = "manual";
    this.title = "Journal Items to Reconcile";
    super.setup();
  }
}

registry
  .category("actions")
  .add("avanzosc_manual_account_reconcile_legacy_view", ManualReconciliationLegacyView);
